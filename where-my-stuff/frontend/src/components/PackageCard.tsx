import { useState, useEffect } from 'react';
import { Copy, Check, X, Hash, ExternalLink } from 'lucide-react';
import type { Package } from '../types';

interface Props {
  pkg: Package;
  onMute: (merchant: string) => void;
  onMarkDelivered: (id: number) => void;
}

const HERO: Record<number, string> = {
  0: 'Order placed', 1: 'Being prepared', 2: 'On its way',
  3: 'On its way', 4: 'Arriving today', 5: 'Delivered', 6: 'Delivery failed',
};

const STAGE_COLOR: Record<number, string> = {
  0: '#9CA3AF', 1: '#A78BFA', 2: '#F59E0B',
  3: '#3B82F6', 4: '#10B981', 5: '#16A34A', 6: '#EF4444',
};

const MERCHANT_ACCENT: Record<string, string> = {
  'Amazon': '#FF6B00', 'Flipkart': '#2874F0', 'Myntra': '#FF3F6C',
  'Nykaa': '#FC2779', 'Nykaa Fashion': '#FC2779', 'Meesho': '#F43F5E',
  'AJIO': '#475569', 'Zara': '#1F2937', 'H&M': '#E11D48',
  'Mango': '#D97706', 'Swiggy': '#FC8019', 'Swiggy Instamart': '#FC8019',
  'Instamart': '#FC8019', 'Blinkit': '#FBBF24', 'Zepto': '#A855F7',
  'BigBasket': '#65A30D', 'Tata Cliq': '#7C3AED', 'Apple': '#6B7280',
  'Croma': '#16A34A', 'Puma': '#DC2626', 'Nike': '#111827',
  'Adidas': '#111827', 'boAt': '#7C3AED', 'Noise': '#0891B2',
  'Mamaearth': '#65A30D', 'Lenskart': '#0891B2', 'Decathlon': '#2563EB',
};

const MERCHANT_EMOJI: Record<string, string> = {
  'Amazon': '📦', 'Flipkart': '🛒', 'Myntra': '👗', 'Nykaa': '💄',
  'Nykaa Fashion': '💋', 'Meesho': '🛍️', 'AJIO': '👔', 'Zara': '🧥',
  'H&M': '🏷️', 'Mango': '🥭', 'Swiggy': '🍕', 'Swiggy Instamart': '⚡',
  'Instamart': '⚡', 'Blinkit': '⚡', 'Zepto': '🟡', 'BigBasket': '🥦',
  'Tata Cliq': '🏪', 'Apple': '🍎', 'Croma': '📱', 'Puma': '👟',
  'Nike': '✔️', 'Adidas': '⚽', 'boAt': '🎧', 'Noise': '⌚',
  'Mamaearth': '🌿', 'Lenskart': '👓', 'Decathlon': '🏅',
  'Netmeds': '💊', 'PharmEasy': '🩺', '1mg': '💉', 'Snapdeal': '🔖',
};

type ProductHint = 'spicy' | 'food' | 'supplement' | 'clothing' | 'book' | 'audio' | 'tech' | 'beauty' | 'footwear' | 'general';

function detectProductHint(subject: string, snippet: string): ProductHint {
  const t = `${subject} ${snippet}`.toLowerCase();
  if (/protein|whey|creatine|supplement|vitamin|bcaa|pre.?workout|mass gainer/i.test(t)) return 'supplement';
  if (/chilli|chilly|spicy|hot sauce|ghost pepper|sriracha|lao gan/i.test(t)) return 'spicy';
  if (/oil|ghee|food|snack|biscuit|chocolate|coffee|tea|kitchen|masala|pickle|sauce/i.test(t)) return 'food';
  if (/tee|t-shirt|shirt|jeans|kurta|dress|saree|top|trouser|hoodie|jacket|clothing|apparel|fashion/i.test(t)) return 'clothing';
  if (/book|novel|fiction|paperback|hardcover|kindle|mistborn|brandon/i.test(t)) return 'book';
  if (/headphone|earphone|earbud|speaker|audio|airdopes|boat|noise|wireless bud/i.test(t)) return 'audio';
  if (/phone|mobile|laptop|tablet|camera|gadget|charger|cable|electronic/i.test(t)) return 'tech';
  if (/skincare|cream|serum|moisturizer|makeup|lipstick|beauty|cosmetic|perfume/i.test(t)) return 'beauty';
  if (/shoe|sneaker|boot|sandal|slipper|footwear|nike|puma|adidas/i.test(t)) return 'footwear';
  return 'general';
}

const CONTEXTUAL: Record<ProductHint, Partial<Record<number, string>>> = {
  spicy:      { 2: "Heat is on the way! 🌶️", 3: "Brace your taste buds — almost there.", 4: "Pre-heat the pan! 🍳", 5: "Time to turn things up. 🔥" },
  food:       { 2: "Something delicious heading your way! 🍽️", 3: "Your food haul is moving. Almost there.", 4: "Lunch plans: sorted. 😋", 5: "Bon appétit! 🍽️" },
  supplement: { 2: "Gains incoming! 💪", 3: "Don't skip today's workout.", 4: "Prep your shaker. Almost there!", 5: "No excuses now. Gains unlocked! 💪" },
  clothing:   { 2: "Fresh fit incoming! 👕", 3: "Your new look is on the move.", 4: "OOTD incoming — almost there! ✨", 5: "New drop delivered. Time to style up! 👗" },
  book:       { 2: "Your next adventure is on its way! 📚", 3: "Stay patient. Great stories take time.", 4: "Chapter one arrives today! 📖", 5: "Happy reading! 📚" },
  audio:      { 2: "Your sound upgrade is en route! 🎧", 3: "Almost there. Then: pure vibes.", 4: "Your vibe arrives today! 🎵", 5: "Plug in and tune out. 🎧" },
  tech:       { 2: "New tech incoming! ⚡", 3: "Gadget on the move. Almost there.", 4: "Tech drop today! 🔋", 5: "Unboxing time! 📱" },
  beauty:     { 2: "Your glow-up is en route! ✨", 3: "Beauty haul incoming. Almost there.", 4: "Your skin is going to love you today! 💆", 5: "Glow up activated! ✨" },
  footwear:   { 2: "New kicks on the way! 👟", 3: "Step up incoming. Almost there.", 4: "Sole delivery today! 👟", 5: "New steps await! 👟" },
  general:    { 2: "Picked up and heading your way.", 3: "Moving through the network. Getting closer.", 4: "Out for delivery — should arrive today!", 5: "Delivered! Hope you love it. 🎉" },
};

function stageSummary(stage: number, carrier: string | null, subject: string, snippet: string): string {
  if (stage === 0) return `Order placed${carrier ? ` — will be handed to ${carrier} soon` : ''}.`;
  if (stage === 1) return `Being packed${carrier ? ` with ${carrier}` : ''} and getting ready to ship.`;
  if (stage === 6) return 'Delivery failed or returned to sender. Check your tracking for details.';
  const hint = detectProductHint(subject, snippet);
  return CONTEXTUAL[hint][stage] ?? CONTEXTUAL.general[stage] ?? '';
}

// Extract "Expected by Friday" or "arriving Apr 8" from snippet
function extractExpected(snippet: string): string | null {
  const m = snippet.match(/arriving\s+(?:by\s+)?((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|today|tomorrow)(?:\s*,?\s*\w+\s+\d+)?)/i)
    ?? snippet.match(/expected\s+(?:delivery\s+)?(?:by\s+)?((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\w+\s+\d+))/i)
    ?? snippet.match(/delivers?\s+by\s+((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\w+\s+\d+))/i);
  if (!m) return null;
  const d = m[1].trim();
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function formatDate(ts: number): string {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 86400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(ts).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

const STATUS_WORDS = /^(has\s+been\s+|has\s+)?(shipped|delivered|dispatched|confirmed|processed|packed|accepted|update)[!.\s–-]*$/i;
const ORDER_NUM_BLACKLIST = /^(confirmed|confirmation|placed|received|shipped|dispatched|delivered|processing|accepted|cancelled|canceled|payment|update|status)$/i;
const STRIP_SUBJECT = [
  /ordered?:\s*/gi,
  /your\s+(?:amazon\s+|flipkart\s+|myntra\s+|nykaa\s+|meesho\s+)?order\s+(?:is\s+)?(?:has been\s+)?(?:confirmed|placed|shipped|dispatched|delivered|out for delivery|on its way)?[:\s–-]*/gi,
  /^(?:has\s+been\s+|has\s+)?(?:shipped|delivered|dispatched|out for delivery|order confirmed|order update|arrived)[!.\s–-]*/i,
  /\b\d{3}-\d{7}-\d{7}\b/g,
  /\band\s+\d+\s+more\s+items?\b/gi,
  // Strip bare date fragments left after prefix removal: "on Mar 25", "on 25 Mar"
  /^on\s+(?:\d+\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*\d*/gi,
];

function cleanText(raw: string): string {
  let s = raw;
  for (const r of STRIP_SUBJECT) s = s.replace(r, '');
  return s.replace(/\s{2,}/g, ' ').replace(/^[:\-–|,;\s"']+|["'!]+$/g, '').trim();
}

function isGoodTitle(s: string): boolean {
  if (s.length <= 6) return false;
  if (STATUS_WORDS.test(s)) return false;
  if (/^(hey|dear|hi|hello)\s+\w/i.test(s)) return false;
  if (/^\d+\s+item/i.test(s)) return false;   // "1 item | Order #"
  if (/^order\s*#?\s*$/i.test(s)) return false; // bare "Order #"
  return true;
}

function getTitle(pkg: Package): string {
  const fromSubject = cleanText(pkg.subject);
  if (isGoodTitle(fromSubject)) {
    const t = fromSubject.slice(0, 55);
    return `"${t}${fromSubject.length > 55 ? '…' : ''}"`;
  }
  if (pkg.snippet) {
    const fromSnippet = cleanText(pkg.snippet);
    if (isGoodTitle(fromSnippet)) return `"${fromSnippet.slice(0, 55)}"`;
  }
  if (pkg.order_number && !ORDER_NUM_BLACKLIST.test(pkg.order_number)) return `Order #${pkg.order_number}`;
  return '';
}

function trackingUrl(carrier: string | null, tracking: string | null): string | null {
  if (!tracking) return null;
  const c = (carrier ?? '').toLowerCase();
  if (c.includes('bluedart'))      return `https://www.bluedart.com/tracking?trackFor=0&track=${tracking}`;
  if (c.includes('delhivery'))     return `https://www.delhivery.com/track/package/${tracking}`;
  if (c.includes('ekart'))         return `https://ekartlogistics.com/shipmenttrack/${tracking}`;
  if (c.includes('dtdc'))          return `https://www.dtdc.in/trace.asp?strCnno=${tracking}`;
  if (c.includes('xpressbees'))    return `https://www.xpressbees.com/track?awbNo=${tracking}`;
  if (c.includes('shadowfax'))     return `https://track.shadowfax.in/?awb=${tracking}`;
  if (c.includes('ecom'))          return `https://ecomexpress.in/tracking/?awb_field=${tracking}`;
  if (c.includes('amazon'))        return `https://www.amazon.in/progress-tracker/package/?ref=ppx_yo_dt_b_track_package`;
  if (c.includes('india post') || c.includes('speed post')) return `https://www.indiapost.gov.in/VAS/Pages/trackconsignment.aspx`;
  // Fallback: Google the tracking number
  return `https://www.google.com/search?q=${encodeURIComponent(`track ${tracking} ${carrier ?? ''}`)}`;
}

function ProgressBar({ stage, color, deliverAnim, glow }: { stage: number; color: string; deliverAnim?: boolean; glow?: boolean }) {
  const [w, setW] = useState(0);
  const isFailed = stage === 6;
  const target = deliverAnim ? 100 : (isFailed ? 0 : (stage / 5) * 100);
  const barColor = deliverAnim ? '#16A34A' : color;
  useEffect(() => { const t = setTimeout(() => setW(target), 80); return () => clearTimeout(t); }, [target]);

  return (
    <div className="relative h-1.5 rounded-full bg-gray-100 overflow-visible">
      <div className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${w}%`,
          background: barColor,
          transition: deliverAnim ? 'width 700ms cubic-bezier(0.4,0,0.2,1), box-shadow 300ms' : 'width 850ms cubic-bezier(0.4,0,0.2,1)',
          boxShadow: glow ? `0 0 10px 3px #16A34A80` : undefined,
        }} />
    </div>
  );
}

export default function PackageCard({ pkg, onMute, onMarkDelivered }: Props) {
  const [copied, setCopied]       = useState(false);
  const [muting, setMuting]       = useState(false);
  const [imgOk, setImgOk]         = useState(true);
  const [delivering, setDelivering] = useState(false);
  const [glow, setGlow]           = useState(false);

  const stage     = Math.min(pkg.stage, 6);
  const color     = STAGE_COLOR[stage];
  const accent    = MERCHANT_ACCENT[pkg.merchant] ?? '#6366F1';
  const emoji     = MERCHANT_EMOJI[pkg.merchant] ?? '📦';
  const hero      = HERO[stage] ?? pkg.status;
  const summary   = stageSummary(stage, pkg.carrier, pkg.subject, pkg.snippet ?? '');
  const title     = getTitle(pkg);
  const titleLine = pkg.carrier ? `${pkg.merchant} · ${pkg.carrier}` : pkg.merchant;
  const expected  = pkg.expected_date ?? (pkg.snippet ? extractExpected(pkg.snippet) : null);
  const hasImage  = !!(pkg.image_url && imgOk);

  const trackUrl = trackingUrl(pkg.carrier, pkg.tracking_number);

  const copyTracking = async () => {
    if (!pkg.tracking_number) return;
    await navigator.clipboard.writeText(pkg.tracking_number);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <article
      className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:-translate-y-0.5 transition-all duration-200 shadow-sm"
      style={{ opacity: muting ? 0 : 1, transform: muting ? 'scale(0.97)' : undefined, transition: 'opacity 280ms, transform 280ms, box-shadow 180ms, translate 180ms' }}
      aria-label={`${pkg.merchant} — ${hero}`}
    >
      {/* Header: Merchant · Carrier + image */}
      <div className="px-4 pt-4 pb-0 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-900 text-base leading-tight">{titleLine}</p>
          {title && <p className="text-xs text-gray-400 mt-0.5 truncate">{title}</p>}
        </div>

        <div
          className="w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center text-3xl flex-shrink-0"
          style={{ background: `${accent}12`, border: `1px solid ${accent}20` }}
          aria-hidden
        >
          {hasImage
            ? <img src={pkg.image_url!} alt="" className="w-full h-full object-cover" onError={() => setImgOk(false)} />
            : emoji}
        </div>

        <button
          onClick={() => { setMuting(true); setTimeout(() => onMute(pkg.merchant), 280); }}
          className="w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors flex-shrink-0 mt-0.5"
          aria-label={`Hide all ${pkg.merchant} packages`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Status + date + expected + progress bar */}
      <div className="px-4 pt-3 pb-0">
        {/* Hero status */}
        <p className="text-2xl font-bold tracking-tight leading-none" style={{ color }}>{hero}</p>

        {/* Date — big, prominent */}
        <p className="text-lg font-semibold text-gray-700 mt-1">{formatDate(pkg.received_date)}</p>

        {/* Expected delivery */}
        {expected && (
          <p className="text-xs text-gray-400 mt-0.5">Expected by <span className="font-semibold text-gray-600">{expected}</span></p>
        )}

        <div className="mt-3">
          <ProgressBar stage={stage} color={color} deliverAnim={delivering} glow={glow} />
        </div>
      </div>

      {/* Info rows */}
      {(pkg.order_number || pkg.tracking_number) && (
        <>
          <div className="mx-4 mt-3 border-t border-gray-100" />
          <div className="px-4 py-2.5 space-y-2">
            {pkg.order_number && !ORDER_NUM_BLACKLIST.test(pkg.order_number) && (
              <div className="flex items-center gap-2 text-xs">
                <Hash className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                <span className="text-gray-400">Order</span>
                <span className="font-mono text-gray-600 ml-auto">{pkg.order_number}</span>
              </div>
            )}
            {pkg.tracking_number && (
              <div className="flex items-center gap-2 text-xs">
                <Hash className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                <span className="text-gray-400">Tracking</span>
                <div className="ml-auto flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-gray-600 truncate max-w-[130px]">{pkg.tracking_number}</span>
                  <button onClick={copyTracking} className="flex-shrink-0 text-gray-300 hover:text-gray-600 transition-colors" aria-label="Copy">
                    {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Actions + contextual message */}
      <div className="mx-4 border-t border-gray-100" />
      <div className="px-4 pt-2.5 pb-1">
        <p className="text-xs text-gray-400 leading-relaxed">{summary}</p>
      </div>
      <div className="px-4 pb-3 flex items-center gap-2">
        {trackUrl && (
          <a href={trackUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all">
            <ExternalLink className="w-3 h-3" />
            Track
          </a>
        )}
        <button
          onClick={() => {
            setDelivering(true);
            setTimeout(() => setGlow(true), 720);
            setTimeout(() => setMuting(true), 1050);
            setTimeout(() => onMarkDelivered(pkg.id), 1330);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-green-50 hover:border-green-300 hover:text-green-700 transition-all">
          <Check className="w-3 h-3" />
          Got it
        </button>
        <p className="text-[10px] text-gray-300 text-right leading-tight ml-auto">From<br />your emails</p>
      </div>
    </article>
  );
}
