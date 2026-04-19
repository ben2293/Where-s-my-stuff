import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Package2, Search, X, EyeOff, Sparkles, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseExpectedDate } from '@/lib/dates';
import Header, { SyncLabel } from './Header';
import PackageCard from './PackageCard';
import CompactPackageRow from './CompactPackageRow';
import type { User, Package } from '../types';

interface Props {
  user: User;
  packages: Package[];
  pkgTotal: number;
  loadingMore: boolean;
  syncing: boolean;
  syncError: string | null;
  onSync: () => void;
  onCleanse: () => void;
  onLoadMore: () => void;
  onLogout: () => void;
  onMarkDelivered: (id: number) => void;
  onResync: (id: number) => Promise<void>;
  onReport: (id: number) => Promise<void>;
  onMoveToActive: (id: number) => Promise<void>;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  blocks: { id: number; type: string; value: string; reason: string }[];
  onDeleteBlock: (id: number) => void;
}

type StageFilter = 'all' | 'active' | 'delivered' | 'failed' | 'return' | 'today' | 'tomorrow';
type DateRange  = 'all' | '7d' | '30d' | '90d';
type SortOrder  = 'newest' | 'oldest';

const STAGE_LABELS: Record<StageFilter, string> = {
  all: 'All', active: 'Active', delivered: 'Delivered',
  failed: 'Failed', return: 'Return', today: 'Today', tomorrow: 'Tomorrow',
};

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
    received_date: Date.now() - 3 * 3600_000, expected_date: 'today' },
  { id: -3, user_email: '', gmail_message_id: 'd3', order_number: null, updated_at: 0,
    merchant: 'Flipkart', carrier: 'Ekart', tracking_number: 'FMPP0098761234',
    status: 'Dispatched', stage: 2, subject: 'boAt Airdopes 141',
    snippet: 'Your order has been dispatched from the seller.',
    received_date: Date.now() - 1 * 86400_000, expected_date: 'tomorrow' },
  { id: -4, user_email: '', gmail_message_id: 'd4', order_number: null, updated_at: 0,
    merchant: 'Nykaa', carrier: 'Delhivery', tracking_number: null,
    status: 'Order Confirmed', stage: 0, subject: 'Lakme 9to5 Weightless Mousse',
    snippet: 'Thank you for your order!',
    received_date: Date.now() - 5 * 3600_000 },
];

const ORDER_BLACKLIST = /^(number|no|id|update|summary|details|status|confirmation|confirmed|regular|express|placed|received|accepted|cancelled|canceled)$/i;

function extractOrderId(pkg: Package): string | null {
  if (pkg.order_number && !ORDER_BLACKLIST.test(pkg.order_number)) return pkg.order_number;
  const text = `${pkg.subject} ${pkg.snippet ?? ''}`;
  const m = text.match(/\b(\d{3}-\d{7}-\d{7})\b/)
    ?? text.match(/\border\s*(?:number|no|id|#)?\s*[#:\s]+([A-Z0-9]{4,20})\b/i);
  if (!m) return null;
  if (ORDER_BLACKLIST.test(m[1])) return null;
  return m[1];
}

function subjectScore(subject: string): number {
  if (/^delivered:\s*\d+\s*item/i.test(subject)) return 0;
  if (/^(shipped|out for delivery|dispatched):\s*\d/i.test(subject)) return 1;
  if (/^ordered?:/i.test(subject)) return 50;
  return 2 + Math.min(subject.length, 30);
}

function mergeGroup(group: Package[]): Package {
  const winner = group.reduce((best, p) =>
    p.stage > best.stage || (p.stage === best.stage && p.received_date > best.received_date) ? p : best
  );
  const bestSubject = group.slice().sort((a, b) => subjectScore(b.subject) - subjectScore(a.subject))[0].subject;
  const bestImage = group.find(p => p.image_url)?.image_url ?? null;
  const bestPrice = group.find(p => p.price)?.price ?? null;
  const bestExpected = group.find(p => p.expected_date)?.expected_date ?? null;
  return { ...winner, subject: bestSubject, image_url: bestImage, price: bestPrice, expected_date: bestExpected };
}

function deduplicate(pkgs: Package[]): Package[] {
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

function applyStageFilter(pkgs: Package[], filter: StageFilter): Package[] {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tMs = today.getTime();

  if (filter === 'delivered') return pkgs.filter(p => p.stage === 5);
  if (filter === 'failed')    return pkgs.filter(p => p.stage === 6);
  if (filter === 'return')    return pkgs.filter(p => p.stage === 7 || p.stage === 8);
  if (filter === 'active')    return pkgs.filter(p => p.stage >= 0 && p.stage < 5);
  if (filter === 'today')     return pkgs.filter(p => {
    if (p.stage >= 5) return false;
    const d = parseExpectedDate(p.expected_date, p.received_date);
    if (d !== null) return d.getTime() >= tMs && d.getTime() < tMs + 86400_000;
    return /arriving\s+today|out\s+for\s+delivery/i.test(`${p.subject} ${p.snippet ?? ''}`);
  });
  if (filter === 'tomorrow')  return pkgs.filter(p => {
    if (p.stage >= 5) return false;
    const d = parseExpectedDate(p.expected_date, p.received_date);
    if (d !== null) return d.getTime() >= tMs + 86400_000 && d.getTime() < tMs + 2 * 86400_000;
    return /arriving\s+tomorrow/i.test(`${p.subject} ${p.snippet ?? ''}`);
  });
  return pkgs;
}

function applyDateRange(pkgs: Package[], range: DateRange): Package[] {
  if (range === 'all') return pkgs;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const cutoff = Date.now() - days * 86400_000;
  return pkgs.filter(p => p.received_date >= cutoff);
}

const DATE_RANGE_LABELS: Record<DateRange, string> = { all: 'All time', '7d': '7 days', '30d': '30 days', '90d': '90 days' };

export default function Dashboard({ user, packages, pkgTotal, loadingMore, syncing, syncError, onSync, onCleanse, onLoadMore, onLogout, onMarkDelivered, onResync, onReport, onMoveToActive, theme, onToggleTheme, blocks, onDeleteBlock }: Props) {
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');
  const [dateRange, setDateRange]     = useState<DateRange>('all');
  const [sortOrder, setSortOrder]     = useState<SortOrder>('newest');
  const [displayLimit, setDisplayLimit] = useState(8);
  const [query, setQuery]             = useState('');
  const [blacklist, setBlacklist]     = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('wms_blacklist') ?? '[]')); }
    catch { return new Set(); }
  });
  const [showMuted, setShowMuted]     = useState(false);
  const [showBlocks, setShowBlocks]   = useState(false);

  const mute = (m: string) => setBlacklist(prev => {
    const n = new Set(prev); n.add(m);
    localStorage.setItem('wms_blacklist', JSON.stringify([...n])); return n;
  });
  const unmute = (m: string) => setBlacklist(prev => {
    const n = new Set(prev); n.delete(m);
    localStorage.setItem('wms_blacklist', JSON.stringify([...n])); return n;
  });

  const handleMute = (m: string) => {
    mute(m);
    toast(`Hidden: ${m}`, {
      duration: 5000,
      action: { label: 'Undo', onClick: () => unmute(m) },
    });
  };

  const isDemo = packages.length === 0 && !user.last_sync;
  const source = useMemo(() => isDemo ? DEMO : deduplicate(packages), [packages, isDemo]);

  const visible = useMemo(() => source.filter(p => {
    if (blacklist.has(p.merchant)) return false;
    const hasOrderId = p.order_number && !ORDER_BLACKLIST.test(p.order_number);
    const hasTracking = !!p.tracking_number;
    if (!hasOrderId && !hasTracking && p.stage >= 1 && p.stage <= 4) return false;
    return true;
  }), [source, blacklist]);

  const filtered = useMemo(() => {
    let list = applyStageFilter(visible, stageFilter);
    list = applyDateRange(list, dateRange);
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
  }, [visible, stageFilter, dateRange, query]);

  const count = (f: StageFilter) => applyStageFilter(visible, f).length;

  function changeFilter(f: StageFilter) { setStageFilter(f); setDisplayLimit(8); }
  function changeDateRange(r: DateRange) { setDateRange(r); setDisplayLimit(8); }

  return (
    <div className="min-h-screen bg-background">
      <Header user={user} syncing={syncing} onSync={onSync} onCleanse={onCleanse} onLogout={onLogout} theme={theme} onToggleTheme={onToggleTheme} />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">

        {isDemo && (
          <div className="mb-5 px-4 py-3 bg-secondary border border-border rounded-xl flex items-center gap-2.5 text-sm text-foreground">
            <Sparkles className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
            <span><strong>Demo</strong> — hit Sync to load your real Gmail deliveries.</span>
          </div>
        )}

        {syncError && (
          <div className="mb-5 px-4 py-3 bg-red-950 border border-red-900 rounded-xl text-red-300 text-sm" role="alert">
            {syncError}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Active',    value: count('active'),    color: 'text-blue-400' },
            { label: 'Delivered', value: count('delivered'), color: 'text-green-400' },
            { label: 'Total',     value: visible.length,     color: 'text-foreground' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4 text-center">
              <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Muted merchants + blocked senders */}
        {(blacklist.size > 0 || blocks.length > 0) && (
          <div className="mb-4">
            <div className="flex items-center gap-4">
              {blacklist.size > 0 && (
                <button onClick={() => setShowMuted(s => !s)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <EyeOff className="w-3.5 h-3.5" />
                  {blacklist.size} hidden · {showMuted ? 'hide' : 'manage'}
                </button>
              )}
              {blocks.length > 0 && (
                <button onClick={() => setShowBlocks(s => !s)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  <EyeOff className="w-3.5 h-3.5" />
                  {blocks.length} blocked · {showBlocks ? 'hide' : 'manage'}
                </button>
              )}
            </div>
            {showMuted && (
              <div className="flex flex-wrap gap-2 mt-2">
                {[...blacklist].map(m => (
                  <button key={m} onClick={() => unmute(m)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-secondary border border-border rounded-full text-xs text-muted-foreground hover:border-muted-foreground transition-all">
                    {m} <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}
            {showBlocks && (
              <div className="flex flex-col gap-1.5 mt-2">
                {blocks.map(b => (
                  <div key={b.id} className="flex items-center justify-between px-3 py-2 bg-secondary border border-border rounded-lg text-xs">
                    <div>
                      <span className="text-foreground font-medium">{b.value}</span>
                      {b.reason && <span className="text-muted-foreground ml-2">· {b.reason}</span>}
                    </div>
                    <button onClick={() => onDeleteBlock(b.id)} className="ml-3 flex-shrink-0 flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                      <X className="w-3 h-3" /> Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search merchant, carrier, tracking…"
            className="w-full pl-10 pr-10 py-2.5 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
          />
          {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>}
        </div>

        {/* Stage filters */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
          {(['all','active','delivered','failed','return','today','tomorrow'] as StageFilter[]).map(f => (
            <button key={f} onClick={() => changeFilter(f)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
                stageFilter === f
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card text-muted-foreground border-border hover:border-muted-foreground'
              }`}
            >
              {STAGE_LABELS[f]}
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${stageFilter === f ? 'bg-black/20' : 'bg-secondary text-muted-foreground'}`}>
                {count(f)}
              </span>
            </button>
          ))}
        </div>

        {/* Date range filters */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {(['all','7d','30d','90d'] as DateRange[]).map(r => (
            <button key={r} onClick={() => changeDateRange(r)}
              className={`px-3 py-1 rounded-full text-xs whitespace-nowrap border transition-all ${
                dateRange === r
                  ? 'bg-secondary text-foreground border-muted-foreground'
                  : 'bg-transparent text-muted-foreground border-border hover:border-muted-foreground/60'
              }`}
            >
              {DATE_RANGE_LABELS[r]}
            </button>
          ))}
        </div>

        {/* Package list */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-12 h-12 bg-card border border-border rounded-2xl flex items-center justify-center mb-4">
              <Package2 className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-foreground font-semibold text-sm">{packages.length === 0 && !isDemo ? 'No packages yet' : 'No results'}</p>
            <p className="text-muted-foreground text-xs mt-1">{packages.length === 0 && !isDemo ? 'Click Sync to fetch your delivery emails' : 'Try a different search or filter'}</p>
            {packages.length === 0 && !isDemo && (
              <Button onClick={onSync} disabled={syncing} className="mt-5" size="lg">
                <SyncLabel syncing={syncing} />
                {!syncing && ' now'}
              </Button>
            )}
          </div>
        ) : (() => {
          const active = filtered.filter(p => p.stage >= 0 && p.stage <= 4);
          const rest   = filtered.filter(p => p.stage < 0 || p.stage > 4)
            .sort((a, b) => sortOrder === 'newest'
              ? b.received_date - a.received_date
              : a.received_date - b.received_date);
          return (
            <div className="space-y-8">
              {active.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 pl-1">
                    Active · {active.length}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 stagger">
                    {active.map(pkg => (
                      <PackageCard key={pkg.id} pkg={pkg} onMute={handleMute} onMarkDelivered={onMarkDelivered} onResync={onResync} onReport={onReport} />
                    ))}
                  </div>
                </section>
              )}

              {rest.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3 pl-1">
                    <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                      {active.length > 0 ? 'Past orders' : 'Orders'} · {rest.length}
                    </h2>
                    <button
                      onClick={() => setSortOrder(s => s === 'newest' ? 'oldest' : 'newest')}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground transition-all"
                    >
                      <ArrowUpDown className="w-3 h-3" />
                      {sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
                    </button>
                  </div>
                  <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
                    {rest.slice(0, displayLimit).map(pkg => <CompactPackageRow key={pkg.id} pkg={pkg} onMute={mute} onReport={onReport} onMoveToActive={onMoveToActive} />)}
                  </div>
                  {(displayLimit < rest.length || packages.length < pkgTotal) && (
                    <button
                      onClick={() => {
                        if (displayLimit < rest.length) {
                          setDisplayLimit(d => d + 10);
                        } else {
                          onLoadMore();
                          setDisplayLimit(d => d + 10);
                        }
                      }}
                      disabled={loadingMore}
                      className="mt-3 w-full py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border hover:border-muted-foreground rounded-xl transition-all disabled:opacity-50"
                    >
                      {loadingMore ? 'Loading…' : `Show more · ${(rest.length - displayLimit) > 0 ? rest.length - displayLimit : pkgTotal - packages.length} remaining`}
                    </button>
                  )}
                </section>
              )}
            </div>
          );
        })()}
      </main>
    </div>
  );
}
