import { useState } from 'react';
import { ChevronRight, ChevronDown, Copy, Check, Hash, Truck, Mail, ThumbsDown } from 'lucide-react';
import type { Package } from '../types';

interface Props {
  pkg: Package;
  onMute: (merchant: string) => void;
  onReport: (id: number) => Promise<void>;
  onMoveToActive: (id: number) => Promise<void>;
}

const STAGE_BADGE: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: 'Ordered',    color: '#9CA3AF', bg: 'rgba(156,163,175,0.15)' },
  5: { label: 'Delivered',  color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  6: { label: 'Failed',     color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  7: { label: 'Return',     color: '#fb923c', bg: 'rgba(251,146,60,0.12)'  },
  8: { label: 'Returned',   color: '#fdba74', bg: 'rgba(253,186,116,0.12)' },
};

const MERCHANT_EMOJI: Record<string, string> = {
  'Amazon':'📦','Flipkart':'🛒','Myntra':'👗','Nykaa':'💄','Nykaa Fashion':'💋',
  'Meesho':'🛍️','AJIO':'👔','Zara':'🧥','H&M':'🏷️','Mango':'🥭',
  'Swiggy':'🍕','Swiggy Instamart':'⚡','Instamart':'⚡','Blinkit':'⚡','Zepto':'🟡',
  'BigBasket':'🥦','Tata Cliq':'🏪','Apple':'🍎','Croma':'📱','Puma':'👟',
  'Nike':'✔️','Adidas':'⚽','boAt':'🎧','Noise':'⌚','Mamaearth':'🌿',
  'Lenskart':'👓','Decathlon':'🏅','Netmeds':'💊','PharmEasy':'🩺',
  '1mg':'💉','Snapdeal':'🔖',
};

function formatDate(ts: number): string {
  if (!ts) return '';
  const then = new Date(ts); then.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - then.getTime()) / 86400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const STATUS_WORDS = /^(has\s+been\s+|has\s+)?(shipped|delivered|dispatched|confirmed|processed|packed|accepted|update)[!.\s–-]*$/i;
const STRIP_RE = [
  /ordered?:\s*/gi,
  /your\s+(?:amazon\s+|flipkart\s+|myntra\s+|nykaa\s+|meesho\s+)?order\s+(?:is\s+)?(?:has been\s+)?(?:confirmed|placed|shipped|dispatched|delivered|out for delivery|on its way)?[:\s–-]*/gi,
  /^(?:has\s+been\s+|has\s+)?(?:shipped|delivered|dispatched|out for delivery|order confirmed|order update|arrived)[!.\s–-]*/i,
  /\b\d{3}-\d{7}-\d{7}\b/g,
  /\band\s+\d+\s+more\s+items?\b/gi,
];

function cleanText(raw: string): string {
  let s = raw;
  for (const r of STRIP_RE) s = s.replace(r, '');
  return s.replace(/\s{2,}/g, ' ').replace(/^[:\-–|,;\s"']+|["'!]+$/g, '').trim();
}

function isGood(s: string): boolean {
  if (s.length <= 6) return false;
  if (STATUS_WORDS.test(s)) return false;
  if (/^(hey|dear|hi|hello)\s+\w/i.test(s)) return false;
  if (/^\d+\s+item/i.test(s)) return false;
  if (/^order\s*#?\s*$/i.test(s)) return false;
  return true;
}

function getTitle(pkg: Package): string {
  const fromSubject = cleanText(pkg.subject);
  if (isGood(fromSubject)) return fromSubject.slice(0, 55);
  if (pkg.snippet) {
    const fromSnippet = cleanText(pkg.snippet);
    if (isGood(fromSnippet)) return fromSnippet.slice(0, 55);
  }
  if (pkg.order_number) return `Order #${pkg.order_number}`;
  return `Order from ${pkg.merchant}`;
}

export default function CompactPackageRow({ pkg, onMute, onReport, onMoveToActive }: Props) {
  const [open, setOpen]         = useState(false);
  const [copied, setCopied]     = useState(false);
  const [reporting, setReporting] = useState(false);
  const [hidden, setHidden]     = useState(false);

  const stage = Math.min(pkg.stage, 8);
  const badge = STAGE_BADGE[stage];
  const emoji = MERCHANT_EMOJI[pkg.merchant] ?? '📦';
  const title = getTitle(pkg);
  const price = pkg.price ? `₹${pkg.price.toLocaleString('en-IN')}` : null;
  const header = pkg.carrier ? `${pkg.merchant} · ${pkg.carrier}` : pkg.merchant;

  const copy = async () => {
    if (!pkg.tracking_number) return;
    await navigator.clipboard.writeText(pkg.tracking_number);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  if (hidden) return null;

  return (
    <div className="group">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-secondary/50 transition-colors text-left"
        aria-expanded={open}
      >
        <span className="text-base flex-shrink-0 w-6 text-center" aria-hidden>{emoji}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-foreground">{pkg.merchant}</span>
            {badge && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ color: badge.color, background: badge.bg }}>
                {badge.label}
              </span>
            )}
          </span>
          {title && (
            <span className="block text-xs text-muted-foreground truncate mt-0.5">{title}</span>
          )}
        </span>

        <span className="flex-shrink-0 text-xs text-muted-foreground w-14 text-right">
          {formatDate(pkg.received_date)}
        </span>

        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        }
      </button>

      {open && (
        <div className="px-4 pb-4 pt-3 bg-secondary/30 border-t border-border text-xs space-y-2.5 animate-fade-up">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <Truck className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span>{header}</span>
          </div>

          {price && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground w-20">Amount</span>
              <span className="font-semibold text-foreground">{price}</span>
            </div>
          )}

          {pkg.order_number && (
            <div className="flex items-center gap-2">
              <Hash className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
              <span className="text-muted-foreground w-20">Order</span>
              <span className="font-mono text-foreground">{pkg.order_number}</span>
            </div>
          )}

          {pkg.tracking_number && (
            <div className="flex items-center gap-2">
              <Hash className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
              <span className="text-muted-foreground w-20">Tracking</span>
              <span className="font-mono text-foreground truncate max-w-[150px]">{pkg.tracking_number}</span>
              <button onClick={copy} className="ml-1 text-muted-foreground hover:text-foreground" aria-label="Copy">
                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          )}

          {pkg.snippet && (() => {
            const s = pkg.snippet.replace(/\s+/g, ' ').trim();
            const sentence = s.split(/[.!]\s/)[0];
            if (sentence && sentence.length > 15 && sentence.length < 120) {
              return (
                <p className="text-muted-foreground italic leading-relaxed pt-0.5">
                  "{sentence.trim()}"
                </p>
              );
            }
            return null;
          })()}

          <div className="flex flex-wrap items-center justify-between gap-y-2 pt-1">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => onMute(pkg.merchant)}
                className="text-[11px] text-muted-foreground/40 hover:text-red-400 transition-colors"
              >
                Hide {pkg.merchant}
              </button>
              <button
                onClick={() => onMoveToActive(pkg.id)}
                className="text-[11px] text-muted-foreground/40 hover:text-blue-400 transition-colors"
              >
                → Active
              </button>
            </div>
            <div className="flex items-center gap-3">
              <a
                href={`https://mail.google.com/mail/u/0/#all/${pkg.thread_id || pkg.gmail_message_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                <Mail className="w-3 h-3" />
                Gmail
              </a>
              <button
                onClick={async () => {
                  setReporting(true);
                  setHidden(true);
                  await onReport(pkg.id);
                }}
                disabled={reporting}
                className="flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-red-400 transition-colors"
                aria-label="Not a delivery"
              >
                <ThumbsDown className="w-3 h-3" />
                Not a delivery
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
