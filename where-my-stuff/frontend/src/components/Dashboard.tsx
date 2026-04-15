import { useState, useMemo } from 'react';
import { Package2, Search, X, EyeOff, Sparkles } from 'lucide-react';
import Header from './Header';
import PackageCard from './PackageCard';
import CompactPackageRow from './CompactPackageRow';
import type { User, Package } from '../types';

interface Props {
  user: User;
  packages: Package[];
  syncing: boolean;
  syncError: string | null;
  onSync: () => void;
  onLogout: () => void;
  onMarkDelivered: (id: number) => void;
}

type Filter = 'all' | 'active' | 'delivered' | 'failed';
const FILTER_LABELS: Record<Filter, string> = { all: 'All', active: 'Active', delivered: 'Delivered', failed: 'Failed' };

const DEMO: Package[] = [
  { id: -1, user_email: '', gmail_message_id: 'd1', order_number: '405-3324017-6516318', updated_at: 0,
    merchant: 'Amazon', carrier: 'Amazon Logistics', tracking_number: '403-3324017-6516318',
    status: 'Delivered', stage: 5, subject: 'Misamo Enterprise Glass Oil Diffuser',
    snippet: 'Your order has been delivered. Thank you for shopping with us.',
    received_date: Date.now() - 2 * 86400_000 },
  { id: -2, user_email: '', gmail_message_id: 'd2', order_number: '406-1234567-9876543', updated_at: 0,
    merchant: 'Myntra', carrier: 'Ekart', tracking_number: 'FMPC0172834650',
    status: 'Out for Delivery', stage: 4, subject: 'Roadster Men Slim Fit Jeans',
    snippet: 'Your order is out for delivery. Expected by today.',
    received_date: Date.now() - 3 * 3600_000 },
  { id: -3, user_email: '', gmail_message_id: 'd3', order_number: null, updated_at: 0,
    merchant: 'Flipkart', carrier: 'Ekart', tracking_number: 'FMPP0098761234',
    status: 'Dispatched', stage: 2, subject: 'boAt Airdopes 141',
    snippet: 'Your order has been dispatched from the seller.',
    received_date: Date.now() - 1 * 86400_000 },
  { id: -4, user_email: '', gmail_message_id: 'd4', order_number: null, updated_at: 0,
    merchant: 'Nykaa', carrier: 'Delhivery', tracking_number: null,
    status: 'Order Confirmed', stage: 0, subject: 'Lakme 9to5 Weightless Mousse',
    snippet: 'Thank you for your order!',
    received_date: Date.now() - 5 * 3600_000 },
];

const ORDER_BLACKLIST = /^(number|no|id|update|summary|details|status|confirmation|confirmed|regular|express|placed|received|accepted|cancelled|canceled)$/i;

function extractOrderId(pkg: Package): string | null {
  // Prefer the DB-stored order_number (extracted from full email body)
  if (pkg.order_number && !ORDER_BLACKLIST.test(pkg.order_number)) return pkg.order_number;
  // Fall back to parsing subject + snippet
  const text = `${pkg.subject} ${pkg.snippet ?? ''}`;
  const m = text.match(/\b(\d{3}-\d{7}-\d{7})\b/)
    ?? text.match(/\border\s*(?:number|no|id|#)?\s*[#:\s]+([A-Z0-9]{4,20})\b/i);
  if (!m) return null;
  if (ORDER_BLACKLIST.test(m[1])) return null;
  return m[1];
}

// Score subjects: higher = more product-name-like
function subjectScore(subject: string): number {
  if (/^delivered:\s*\d+\s*item/i.test(subject)) return 0;      // "Delivered: 1 item | Order #" — useless
  if (/^(shipped|out for delivery|dispatched):\s*\d/i.test(subject)) return 1;
  if (/^ordered?:/i.test(subject)) return 50;                   // "Ordered: Lao Gan Ma..." — has product name
  return 2 + Math.min(subject.length, 30);
}

function mergeGroup(group: Package[]): Package {
  const winner = group.reduce((best, p) =>
    p.stage > best.stage || (p.stage === best.stage && p.received_date > best.received_date) ? p : best
  );
  const bestSubject = group.slice().sort((a, b) => subjectScore(b.subject) - subjectScore(a.subject))[0].subject;
  const bestImage = group.find(p => p.image_url)?.image_url ?? null;
  const bestPrice = group.find(p => p.price)?.price ?? null;
  return { ...winner, subject: bestSubject, image_url: bestImage, price: bestPrice };
}

function deduplicate(pkgs: Package[]): Package[] {
  // Pass 1: group by order ID → tracking → thread → subject
  const groups = new Map<string, Package[]>();
  for (const pkg of pkgs) {
    const orderId = extractOrderId(pkg);
    const key = orderId
      ? `ord:${pkg.merchant}:${orderId}`
      : pkg.tracking_number
      ? `trk:${pkg.tracking_number.trim()}`
      : pkg.thread_id
      ? `thd:${pkg.thread_id}`
      : `sub:${pkg.merchant}:${pkg.subject.slice(0, 40).toLowerCase()}`;
    const arr = groups.get(key) ?? [];
    arr.push(pkg);
    groups.set(key, arr);
  }

  // Pass 2: merge any groups that share a tracking number
  // (handles case where order ID extraction differs across email types)
  const trkToKey = new Map<string, string>();
  const merged = new Map<string, Package[]>();
  for (const [key, group] of groups) {
    const trk = group.find(p => p.tracking_number)?.tracking_number?.trim();
    if (trk) {
      const existing = trkToKey.get(trk);
      if (existing && merged.has(existing)) {
        merged.get(existing)!.push(...group);
        continue;
      }
      trkToKey.set(trk, key);
    }
    merged.set(key, [...(merged.get(key) ?? []), ...group]);
  }

  return [...merged.values()]
    .map(mergeGroup)
    .sort((a, b) => b.received_date - a.received_date);
}


function applyFilter(pkgs: Package[], filter: Filter): Package[] {
  if (filter === 'delivered') return pkgs.filter(p => p.stage === 5);
  if (filter === 'failed')    return pkgs.filter(p => p.stage === 6);
  if (filter === 'active')    return pkgs.filter(p => p.stage > 0 && p.stage < 5);
  return pkgs;
}

export default function Dashboard({ user, packages, syncing, syncError, onSync, onLogout, onMarkDelivered }: Props) {
  const [filter, setFilter]   = useState<Filter>('all');
  const [query, setQuery]     = useState('');
  const [blacklist, setBlacklist] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('wms_blacklist') ?? '[]')); }
    catch { return new Set(); }
  });
  const [showMuted, setShowMuted] = useState(false);

  const mute = (m: string) => setBlacklist(prev => {
    const n = new Set(prev); n.add(m);
    localStorage.setItem('wms_blacklist', JSON.stringify([...n])); return n;
  });
  const unmute = (m: string) => setBlacklist(prev => {
    const n = new Set(prev); n.delete(m);
    localStorage.setItem('wms_blacklist', JSON.stringify([...n])); return n;
  });

  const isDemo = packages.length === 0 && !user.last_sync;
  const source = useMemo(() => isDemo ? DEMO : deduplicate(packages), [packages, isDemo]);
  const visible = useMemo(() => source.filter(p => {
    if (blacklist.has(p.merchant)) return false;
    // Hide active cards with no way to identify/track them
    const hasOrderId = p.order_number && !ORDER_BLACKLIST.test(p.order_number);
    const hasTracking = !!p.tracking_number;
    if (!hasOrderId && !hasTracking && p.stage >= 1 && p.stage <= 4) return false;
    return true;
  }), [source, blacklist]);

  const filtered = useMemo(() => {
    let list = applyFilter(visible, filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(p =>
        p.merchant.toLowerCase().includes(q) ||
        p.status.toLowerCase().includes(q) ||
        p.carrier?.toLowerCase().includes(q) ||
        p.tracking_number?.toLowerCase().includes(q) ||
        p.subject.toLowerCase().includes(q)
      );
    }
    return list;
  }, [visible, filter, query]);

  const count = (f: Filter) => applyFilter(visible, f).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} syncing={syncing} onSync={onSync} onLogout={onLogout} />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">

        {isDemo && (
          <div className="mb-5 px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center gap-2.5 text-sm text-indigo-700">
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            <span><strong>Demo</strong> — hit Sync to load your real Gmail deliveries.</span>
          </div>
        )}

        {syncError && (
          <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm" role="alert">
            {syncError}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Active',    value: count('active'),    color: 'text-blue-600' },
            { label: 'Delivered', value: count('delivered'), color: 'text-green-600' },
            { label: 'Total',     value: visible.length,     color: 'text-indigo-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white border border-gray-200 rounded-2xl p-4 text-center shadow-sm">
              <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Muted */}
        {blacklist.size > 0 && (
          <div className="mb-4">
            <button onClick={() => setShowMuted(s => !s)} className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
              <EyeOff className="w-3.5 h-3.5" />
              {blacklist.size} hidden · {showMuted ? 'hide' : 'manage'}
            </button>
            {showMuted && (
              <div className="flex flex-wrap gap-2 mt-2">
                {[...blacklist].map(m => (
                  <button key={m} onClick={() => unmute(m)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-white border border-gray-200 rounded-full text-xs text-gray-500 hover:border-gray-400 transition-all">
                    {m} <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search merchant, carrier, tracking…"
            className="w-full pl-10 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-indigo-400 shadow-sm transition-colors"
          />
          {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>}
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {(['all','active','delivered','failed'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
                filter === f
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
              }`}
            >
              {FILTER_LABELS[f]}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${filter === f ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                {count(f)}
              </span>
            </button>
          ))}
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 bg-white border border-gray-200 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
              <Package2 className="w-6 h-6 text-gray-300" />
            </div>
            <p className="text-gray-500 font-semibold text-sm">{packages.length === 0 && !isDemo ? 'No packages yet' : 'No results'}</p>
            <p className="text-gray-400 text-xs mt-1">{packages.length === 0 && !isDemo ? 'Click Sync to fetch your delivery emails' : 'Try a different search or filter'}</p>
            {packages.length === 0 && !isDemo && (
              <button onClick={onSync} disabled={syncing} className="mt-5 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
          </div>
        ) : (() => {
          // Split: active (stages 1-4) = hero cards; rest (0, 5, 6) = compact rows
          const active = filtered.filter(p => p.stage >= 1 && p.stage <= 4);
          const rest   = filtered.filter(p => p.stage < 1 || p.stage > 4)
            .sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
          return (
            <div className="space-y-8">
              {/* Hero cards — active shipments */}
              {active.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 pl-1">
                    Active · {active.length}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 stagger">
                    {active.map(pkg => <PackageCard key={pkg.id} pkg={pkg} onMute={mute} onMarkDelivered={onMarkDelivered} />)}
                  </div>
                </section>
              )}

              {/* Compact list — delivered, confirmed, failed */}
              {rest.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 pl-1">
                    {active.length > 0 ? 'Past orders' : 'Orders'} · {rest.length}
                  </h2>
                  <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-100">
                    {rest.map(pkg => <CompactPackageRow key={pkg.id} pkg={pkg} onMute={mute} />)}
                  </div>
                </section>
              )}
            </div>
          );
        })()}
      </main>
    </div>
  );
}
