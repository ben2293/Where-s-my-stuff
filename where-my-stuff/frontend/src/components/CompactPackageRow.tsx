import { useState } from 'react';
import { ChevronRight, ChevronDown, Copy, Check, Hash, Truck } from 'lucide-react';
import type { Package } from '../types';

interface Props {
  pkg: Package;
  onMute: (merchant: string) => void;
}

const STAGE_BADGE: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: 'Confirmed',  color: '#9CA3AF', bg: '#F3F4F6' },
  5: { label: 'Delivered',  color: '#16A34A', bg: '#F0FDF4' },
  6: { label: 'Failed',     color: '#DC2626', bg: '#FEF2F2' },
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
  const diff = Math.floor((Date.now() - ts) / 86400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
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
  // Strip leading punctuation/whitespace left over after regex removes prefix
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

function extractPrice(snippet: string): string | null {
  const m = snippet.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i)
    ?? snippet.match(/(?:total|paid|amount|price)[:\s]+(?:₹|Rs\.?)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''));
  if (isNaN(n) || n < 1 || n > 500000) return null;
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function CompactPackageRow({ pkg, onMute }: Props) {
  const [open, setOpen]     = useState(false);
  const [copied, setCopied] = useState(false);

  const stage = Math.min(pkg.stage, 6);
  const badge = STAGE_BADGE[stage];
  const emoji = MERCHANT_EMOJI[pkg.merchant] ?? '📦';
  const title = getTitle(pkg);
  // Prefer DB-extracted price, fall back to snippet parse
  const price = pkg.price
    ? `₹${pkg.price.toLocaleString('en-IN')}`
    : (pkg.snippet ? extractPrice(pkg.snippet) : null);
  const header = pkg.carrier ? `${pkg.merchant} · ${pkg.carrier}` : pkg.merchant;

  const copy = async () => {
    if (!pkg.tracking_number) return;
    await navigator.clipboard.writeText(pkg.tracking_number);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group">
      {/* Main row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
        aria-expanded={open}
      >
        <span className="text-base flex-shrink-0 w-6 text-center" aria-hidden>{emoji}</span>

        {/* Title */}
        <span className="flex-1 min-w-0 text-sm text-gray-700 font-medium truncate">{title}</span>

        {badge && (
          <span className="flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ color: badge.color, background: badge.bg }}>
            {badge.label}
          </span>
        )}

        <span className="flex-shrink-0 text-xs text-gray-400 hidden sm:block w-14 text-right">
          {formatDate(pkg.received_date)}
        </span>

        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        }
      </button>

      {/* Expanded details */}
      {open && (
        <div className="px-4 pb-4 pt-3 bg-gray-50 border-t border-gray-100 text-xs space-y-2.5 animate-fade-up">
          {/* Brand · Carrier */}
          <div className="flex items-center gap-2 text-gray-700 font-semibold">
            <Truck className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <span>{header}</span>
          </div>

          {price && (
            <div className="flex items-center gap-2">
              <span className="text-gray-400 w-20">Amount</span>
              <span className="font-semibold text-gray-700">{price}</span>
            </div>
          )}

          {pkg.order_number && (
            <div className="flex items-center gap-2">
              <Hash className="w-3 h-3 text-gray-300 flex-shrink-0" />
              <span className="text-gray-400 w-20">Order</span>
              <span className="font-mono text-gray-600">{pkg.order_number}</span>
            </div>
          )}

          {pkg.tracking_number && (
            <div className="flex items-center gap-2">
              <Hash className="w-3 h-3 text-gray-300 flex-shrink-0" />
              <span className="text-gray-400 w-20">Tracking</span>
              <span className="font-mono text-gray-600 truncate max-w-[150px]">{pkg.tracking_number}</span>
              <button onClick={copy} className="ml-1 text-gray-400 hover:text-gray-700" aria-label="Copy">
                {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          )}

          {/* Snippet summary — first sentence only */}
          {pkg.snippet && (() => {
            const s = pkg.snippet.replace(/\s+/g, ' ').trim();
            const sentence = s.split(/[.!]\s/)[0];
            if (sentence && sentence.length > 15 && sentence.length < 120) {
              return (
                <p className="text-gray-400 italic leading-relaxed pt-0.5">
                  "{sentence.trim()}"
                </p>
              );
            }
            return null;
          })()}

          <button
            onClick={() => onMute(pkg.merchant)}
            className="text-[11px] text-gray-300 hover:text-red-400 transition-colors pt-0.5"
          >
            Hide all {pkg.merchant} orders
          </button>
        </div>
      )}
    </div>
  );
}
