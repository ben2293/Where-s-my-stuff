import { useState, useEffect } from 'react';
import { Copy, Check, X, Hash, ExternalLink, RefreshCw, AlertCircle, ThumbsDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { countdownLabel } from '@/lib/dates';
import type { Package } from '../types';

interface Props {
  pkg: Package;
  onMute: (merchant: string) => void;
  onMarkDelivered: (id: number) => void;
  onResync: (id: number) => Promise<void>;
  onReport: (id: number) => Promise<void>;
}

const HERO: Record<number, string> = {
  0: 'Order placed', 1: 'Being prepared', 2: 'On its way',
  3: 'On its way', 4: 'Arriving today', 5: 'Delivered', 6: 'Delivery failed',
};

const STAGE_COLOR: Record<number, string> = {
  0: '#6B7280', 1: '#A78BFA', 2: '#F59E0B',
  3: '#3B82F6', 4: '#10B981', 5: '#16A34A', 6: '#EF4444',
};

const MERCHANT_ACCENT: Record<string, string> = {
  'Amazon': '#FF6B00', 'Flipkart': '#2874F0', 'Myntra': '#FF3F6C',
  'Nykaa': '#FC2779', 'Nykaa Fashion': '#FC2779', 'Meesho': '#F43F5E',
  'AJIO': '#475569', 'Zara': '#E5E7EB', 'H&M': '#E11D48',
  'Mango': '#D97706', 'Swiggy': '#FC8019', 'Swiggy Instamart': '#FC8019',
  'Instamart': '#FC8019', 'Blinkit': '#FBBF24', 'Zepto': '#A855F7',
  'BigBasket': '#65A30D', 'Tata Cliq': '#7C3AED', 'Apple': '#9CA3AF',
  'Croma': '#16A34A', 'Puma': '#DC2626', 'Nike': '#E5E7EB',
  'Adidas': '#E5E7EB', 'boAt': '#7C3AED', 'Noise': '#0891B2',
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

function formatDate(ts: number): string {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 86400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(ts).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

const ORDER_NUM_BLACKLIST = /^(confirmed|confirmation|placed|received|shipped|dispatched|delivered|processing|accepted|cancelled|canceled|payment|update|status)$/i;
const STATUS_WORDS = /^(has\s+been\s+|has\s+)?(shipped|delivered|dispatched|confirmed|processed|packed|accepted|update)[!.\s–-]*$/i;
const STRIP_SUBJECT = [
  /ordered?:\s*/gi,
  /your\s+(?:amazon\s+|flipkart\s+|myntra\s+|nykaa\s+|meesho\s+)?order\s+(?:is\s+)?(?:has been\s+)?(?:confirmed|placed|shipped|dispatched|delivered|out for delivery|on its way)?[:\s–-]*/gi,
  /^(?:has\s+been\s+|has\s+)?(?:shipped|delivered|dispatched|out for delivery|order confirmed|order update|arrived)[!.\s–-]*/i,
  /\b\d{3}-\d{7}-\d{7}\b/g,
  /\band\s+\d+\s+more\s+items?\b/gi,
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
  if (/^\d+\s+item/i.test(s)) return false;
  if (/^order\s*#?\s*$/i.test(s)) return false;
  return true;
}

function getTitle(pkg: Package): string {
  const fromSubject = cleanText(pkg.subject);
  if (isGoodTitle(fromSubject)) return `${fromSubject.slice(0, 55)}${fromSubject.length > 55 ? '…' : ''}`;
  if (pkg.snippet) {
    const fromSnippet = cleanText(pkg.snippet);
    if (isGoodTitle(fromSnippet)) return fromSnippet.slice(0, 55);
  }
  if (pkg.order_number && !ORDER_NUM_BLACKLIST.test(pkg.order_number)) return `Order #${pkg.order_number}`;
  return '';
}

function trackingUrl(carrier: string | null, tracking: string | null): string | null {
  if (!tracking) return null;
  const c = (carrier ?? '').toLowerCase();
  if (c.includes('bluedart'))   return `https://www.bluedart.com/tracking?trackFor=0&track=${tracking}`;
  if (c.includes('delhivery'))  return `https://www.delhivery.com/track/package/${tracking}`;
  if (c.includes('ekart'))      return `https://ekartlogistics.com/shipmenttrack/${tracking}`;
  if (c.includes('dtdc'))       return `https://www.dtdc.in/trace.asp?strCnno=${tracking}`;
  if (c.includes('xpressbees')) return `https://www.xpressbees.com/track?awbNo=${tracking}`;
  if (c.includes('shadowfax'))  return `https://track.shadowfax.in/?awb=${tracking}`;
  if (c.includes('ecom'))       return `https://ecomexpress.in/tracking/?awb_field=${tracking}`;
  if (c.includes('amazon'))     return `https://www.amazon.in/progress-tracker/package/?ref=ppx_yo_dt_b_track_package`;
  if (c.includes('india post') || c.includes('speed post')) return `https://www.indiapost.gov.in/VAS/Pages/trackconsignment.aspx`;
  return `https://www.google.com/search?q=${encodeURIComponent(`track ${tracking} ${carrier ?? ''}`)}`;
}

function ProgressBar({ stage, color, deliverAnim, glow }: { stage: number; color: string; deliverAnim?: boolean; glow?: boolean }) {
  const [w, setW] = useState(0);
  const isFailed = stage === 6;
  const target = deliverAnim ? 100 : (isFailed ? 0 : (stage / 5) * 100);
  const barColor = deliverAnim ? '#16A34A' : color;
  useEffect(() => { const t = setTimeout(() => setW(target), 80); return () => clearTimeout(t); }, [target]);

  return (
    <div className="relative h-1.5 rounded-full bg-white/10 overflow-visible">
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

export default function PackageCard({ pkg, onMute, onMarkDelivered, onResync, onReport }: Props) {
  const [copied, setCopied]       = useState(false);
  const [muting, setMuting]       = useState(false);
  const [imgOk, setImgOk]         = useState(true);
  const [delivering, setDelivering] = useState(false);
  const [glow, setGlow]           = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [reporting, setReporting] = useState(false);

  const stage    = Math.min(pkg.stage, 6);
  const color    = STAGE_COLOR[stage];
  const accent   = MERCHANT_ACCENT[pkg.merchant] ?? '#6366F1';
  const emoji    = MERCHANT_EMOJI[pkg.merchant] ?? '📦';
  const hero     = HERO[stage] ?? pkg.status;
  const summary  = stageSummary(stage, pkg.carrier, pkg.subject, `${pkg.snippet ?? ''} ${pkg.merchant}`);
  const title    = getTitle(pkg);
  const titleLine = pkg.carrier ? `${pkg.merchant} · ${pkg.carrier}` : pkg.merchant;
  const hasImage = !!(pkg.image_url && imgOk);
  const trackUrl = trackingUrl(pkg.carrier, pkg.tracking_number);

  const countdown = countdownLabel(pkg.expected_date, pkg.received_date, stage);
  const isOverdue = countdown?.overdue ?? false;

  const copyTracking = async () => {
    if (!pkg.tracking_number) return;
    await navigator.clipboard.writeText(pkg.tracking_number);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const handleResync = async () => {
    setResyncing(true);
    await onResync(pkg.id);
    setResyncing(false);
  };

  const handleReport = async () => {
    setReporting(true);
    setMuting(true);
    setTimeout(() => onReport(pkg.id), 280);
  };

  return (
    <Card
      className={cn(
        'pkg-card relative overflow-hidden pt-0 transition-all duration-200',
        isOverdue && 'ring-1 ring-red-800',
        muting && 'opacity-0 scale-95'
      )}
      style={{ transition: muting ? 'opacity 280ms, transform 280ms' : undefined }}
      aria-label={`${pkg.merchant} — ${hero}`}
    >
      {/* Top image / accent area */}
      <div className="relative aspect-video overflow-hidden bg-secondary">
        <div className="absolute inset-0 z-10 bg-black/40" />

        {hasImage ? (
          <img
            src={pkg.image_url!}
            alt=""
            className="relative z-0 w-full h-full object-cover"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-5xl bg-zinc-800"
          >
            {emoji}
          </div>
        )}

        {/* Stage badge top-right — overdue overrides */}
        <div className="absolute top-3 right-3 z-20">
          {isOverdue ? (
            <Badge className="text-[11px] font-semibold border-0 bg-red-950/80 text-red-400 gap-1">
              <AlertCircle className="w-3 h-3" />
              {countdown!.text}
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="text-[11px] font-semibold border-0"
              style={{ background: `${color}25`, color }}
            >
              {hero}
            </Badge>
          )}
        </div>

        {/* Dismiss top-left */}
        <button
          onClick={() => { setMuting(true); setTimeout(() => onMute(pkg.merchant), 280); }}
          className="absolute top-3 left-3 z-20 w-6 h-6 flex items-center justify-center rounded-full bg-black/40 text-white/60 hover:text-white hover:bg-black/60 transition-colors"
          aria-label={`Hide all ${pkg.merchant} packages`}
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Card header */}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base leading-tight truncate">{titleLine}</CardTitle>
            {title && <CardDescription className="mt-0.5 text-xs truncate">{title}</CardDescription>}
          </div>
          <CardAction>
            {pkg.price != null && (
              <span className="text-sm font-bold text-foreground whitespace-nowrap">
                ₹{pkg.price.toLocaleString('en-IN')}
              </span>
            )}
          </CardAction>
        </div>

        {/* Date + countdown */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-xs text-muted-foreground">{formatDate(pkg.received_date)}</span>
          {countdown && !isOverdue && (
            <>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <span className="text-xs font-medium" style={{ color }}>
                {countdown.text}
              </span>
            </>
          )}
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <ProgressBar stage={stage} color={isOverdue ? '#EF4444' : color} deliverAnim={delivering} glow={glow} />
        </div>
      </CardHeader>

      {/* Tracking / order info */}
      {(pkg.order_number || pkg.tracking_number) && (
        <div className="px-6 pb-2 space-y-1.5">
          {pkg.order_number && !ORDER_NUM_BLACKLIST.test(pkg.order_number) && !title.startsWith(`Order #${pkg.order_number}`) && (
            <div className="flex items-center gap-2 text-xs">
              <Hash className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
              <span className="text-muted-foreground">Order</span>
              <span className="font-mono text-foreground ml-auto">{pkg.order_number}</span>
            </div>
          )}
          {pkg.tracking_number && (
            <div className="flex items-center gap-2 text-xs">
              <Hash className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
              <span className="text-muted-foreground">Tracking</span>
              <div className="ml-auto flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-foreground truncate max-w-[130px]">{pkg.tracking_number}</span>
                <button onClick={copyTracking} className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors" aria-label="Copy">
                  {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contextual summary */}
      <div className="px-6 pb-2 pt-1">
        <p className="text-xs text-muted-foreground leading-relaxed">{summary}</p>
      </div>

      <CardFooter className="gap-2 pt-0">
        {trackUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={trackUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3 h-3" />
              Track
            </a>
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="hover:bg-green-950 hover:border-green-800 hover:text-green-400"
          onClick={() => {
            setDelivering(true);
            setTimeout(() => setGlow(true), 720);
            setTimeout(() => setMuting(true), 1050);
            setTimeout(() => onMarkDelivered(pkg.id), 1330);
          }}
        >
          <Check className="w-3 h-3" />
          Got it
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground/50 hover:text-muted-foreground px-2"
          onClick={handleResync}
          disabled={resyncing}
          aria-label="Re-sync this order"
        >
          <RefreshCw className={cn('w-3 h-3', resyncing && 'animate-spin')} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground/50 hover:text-red-500 px-2 ml-auto"
          onClick={handleReport}
          disabled={reporting}
          aria-label="Not a delivery — report this"
        >
          <ThumbsDown className="w-3 h-3" />
        </Button>
      </CardFooter>
    </Card>
  );
}
