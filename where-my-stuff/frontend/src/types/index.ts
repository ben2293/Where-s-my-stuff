export interface User {
  email: string;
  name: string;
  picture?: string;
  last_sync: number;
}

export interface Package {
  id: number;
  user_email: string;
  gmail_message_id: string;
  merchant: string;
  carrier: string | null;
  tracking_number: string | null;
  order_number: string | null;
  status: string;
  stage: number; // 0-5 normal, 6 = failed/returned
  subject: string;
  received_date: number;
  snippet: string;
  thread_id?: string | null;
  image_url?: string | null;
  price?: number | null;
  currency?: string | null;
  expected_date?: string | null;
  product_name?: string | null;
  updated_at: number;
}

export const STAGE_LABELS = [
  'Ordered',
  'Processing',
  'Dispatched',
  'In Transit',
  'Out for Delivery',
  'Delivered',
];

export const STAGE_SHORT = ['Ordered', 'Packing', 'Shipped', 'Transit', 'OFD', 'Done'];

// Tailwind colour classes per stage (0-5, +6 for failed)
export const STAGE_COLORS = [
  { dot: 'bg-indigo-500',  badge: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25',  text: 'text-indigo-400'  },
  { dot: 'bg-violet-500',  badge: 'bg-violet-500/15 text-violet-400 border-violet-500/25',  text: 'text-violet-400'  },
  { dot: 'bg-amber-500',   badge: 'bg-amber-500/15  text-amber-400  border-amber-500/25',   text: 'text-amber-400'   },
  { dot: 'bg-blue-500',    badge: 'bg-blue-500/15   text-blue-400   border-blue-500/25',    text: 'text-blue-400'    },
  { dot: 'bg-cyan-400',    badge: 'bg-cyan-500/15   text-cyan-400   border-cyan-500/25',    text: 'text-cyan-400'    },
  { dot: 'bg-emerald-500', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25', text: 'text-emerald-400' },
  { dot: 'bg-red-500',     badge: 'bg-red-500/15    text-red-400    border-red-500/25',     text: 'text-red-400'     }, // failed
];

export const MERCHANT_EMOJI: Record<string, string> = {
  'Amazon': '📦', 'Flipkart': '🛒', 'Myntra': '👗', 'Nykaa': '💄',
  'Meesho': '🛍️', 'AJIO': '👔', 'Zara': '👘', 'H&M': '🏷️',
  'Swiggy': '🍕', 'Blinkit': '⚡', 'Zepto': '🟡', 'BigBasket': '🥦',
  'Tata Cliq': '🏪', 'Snapdeal': '🔖', 'Netmeds': '💊', 'PharmEasy': '🩺',
  '1mg': '💉', 'Lenskart': '👓', 'Decathlon': '🏅', 'Apple': '🍎',
  'Croma': '📱', 'Puma': '👟', 'Nike': '✔️', 'Adidas': '⚽',
  'boAt': '🎧', 'Noise': '⌚', 'Mamaearth': '🌿', 'Mango': '🥭',
};
