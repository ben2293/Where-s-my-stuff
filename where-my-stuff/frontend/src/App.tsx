import { useState, useEffect } from 'react';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';

interface Shipment {
  id: string;
  itemName: string;
  merchant: { name: string };
  status: string;
  statusLabel: string;
  eta: { label: string; date: string };
  orderNumber: string;
  trackingNumber: string;
  carrier: string;
  group: string;
  trackingUrl?: string;
  category?: string;
  rawSubject?: string;
}

const brandConfig: Record<string, { gradient: string; logo: string; textColor: string }> = {
  'Amazon India': { gradient: 'linear-gradient(135deg, #FF9900 0%, #FFB347 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg', textColor: '#232F3E' },
  Amazon: { gradient: 'linear-gradient(135deg, #FF9900 0%, #FFB347 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg', textColor: '#232F3E' },
  Flipkart: { gradient: 'linear-gradient(135deg, #2874F0 0%, #5B9CF6 100%)', logo: 'https://logos-world.net/wp-content/uploads/2020/11/Flipkart-Emblem.png', textColor: '#FFFFFF' },
  Myntra: { gradient: 'linear-gradient(135deg, #FF3F6C 0%, #FF6B8A 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/b/b3/Myntra_logo.png', textColor: '#FFFFFF' },
  Nykaa: { gradient: 'linear-gradient(135deg, #FC2779 0%, #FF6BA3 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/9/9e/Nykaa_Logo.svg', textColor: '#FFFFFF' },
  Meesho: { gradient: 'linear-gradient(135deg, #570A57 0%, #8B1A8B 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/0/0f/Meesho_Logo.svg', textColor: '#FFFFFF' },
  AJIO: { gradient: 'linear-gradient(135deg, #4A4A4A 0%, #6B6B6B 100%)', logo: 'https://upload.wikimedia.org/wikipedia/commons/1/14/AJIO_Logo.svg', textColor: '#FFFFFF' },
  Delhivery: { gradient: 'linear-gradient(135deg, #E31837 0%, #FF4D6A 100%)', logo: '/logos/delhivery.png', textColor: '#FFFFFF' },
  BlueDart: { gradient: 'linear-gradient(135deg, #003087 0%, #0052CC 100%)', logo: '/logos/bluedart.png', textColor: '#FFFFFF' },
  DTDC: { gradient: 'linear-gradient(135deg, #0066B3 0%, #3399E6 100%)', logo: '/logos/dtdc.png', textColor: '#FFFFFF' },
  Ekart: { gradient: 'linear-gradient(135deg, #2874F0 0%, #5B9CF6 100%)', logo: '/logos/ekart.png', textColor: '#FFFFFF' },
  Shadowfax: { gradient: 'linear-gradient(135deg, #000000 0%, #434343 100%)', logo: '/logos/shadowfax.png', textColor: '#FFFFFF' },
  Xpressbees: { gradient: 'linear-gradient(135deg, #FF6B00 0%, #FFA500 100%)', logo: '/logos/xpressbees.png', textColor: '#FFFFFF' },
  Shiprocket: { gradient: 'linear-gradient(135deg, #3B5998 0%, #8B9DC3 100%)', logo: '/logos/shiprocket.png', textColor: '#FFFFFF' },
  'Ecom Express': { gradient: 'linear-gradient(135deg, #FF4500 0%, #FF6347 100%)', logo: '/logos/ecomexpress.png', textColor: '#FFFFFF' },
  default: { gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', logo: '', textColor: '#FFFFFF' },
};

// @ts-ignore - unused in new UI, kept for future use
const categoryImages: Record<string, string> = {
  electronics: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=400&h=300&fit=crop',
  fashion: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=400&h=300&fit=crop',
  beauty: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=400&h=300&fit=crop',
  books: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?w=400&h=300&fit=crop',
  grocery: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400&h=300&fit=crop',
  home: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&h=300&fit=crop',
  sports: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=400&h=300&fit=crop',
  toys: 'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=400&h=300&fit=crop',
  default: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=400&h=300&fit=crop',
};

// @ts-ignore - unused in new UI, kept for future use
function detectCategory(itemName: string, merchant: string): string {
  const lower = `${itemName.toLowerCase()} ${merchant.toLowerCase()}`;
  if (/phone|laptop|tablet|watch|headphone|earphone|charger|cable|electronic|gadget|camera|speaker/i.test(lower)) return 'electronics';
  if (/shirt|dress|jeans|shoes|jacket|kurta|saree|t-shirt|pants|clothing|wear|fashion/i.test(lower) || merchant === 'Myntra') return 'fashion';
  if (/cream|serum|lipstick|makeup|skincare|shampoo|beauty|cosmetic/i.test(lower) || merchant === 'Nykaa') return 'beauty';
  if (/book|novel|textbook|magazine/i.test(lower)) return 'books';
  if (/food|grocery|snack|fruit|vegetable/i.test(lower)) return 'grocery';
  if (/furniture|decor|kitchen|home|lamp|curtain/i.test(lower)) return 'home';
  if (/fitness|yoga|sport|gym|ball/i.test(lower)) return 'sports';
  if (/toy|game|puzzle|lego/i.test(lower)) return 'toys';
  return 'default';
}

function generateAISummary(shipment: Shipment): string {
  const status = shipment.status.toUpperCase();
  const merchant = shipment.merchant.name;
  const carrier = shipment.carrier || 'carrier';
  const eta = shipment.eta.date;
  
  if (status === 'DELIVERED') {
    return `Delivered ${eta}. Package handed over successfully. You can find delivery proof in the ${merchant} app.`;
  }
  
  if (status.includes('OUT') || status.includes('DELIVERY')) {
    return `Out for delivery since this morning. Currently with delivery agent. Expected by ${eta}. Track live on ${merchant} app.`;
  }
  
  if (status.includes('TRANSIT')) {
    return `Shipped from origin. Currently at sorting facility. Should reach local hub tomorrow and deliver by ${eta}.`;
  }
  
  if (status.includes('FAIL') || status.includes('EXCEPTION')) {
    return `Delivery attempted but failed. Package at ${carrier} hub. Will be retried tomorrow. You can reschedule via ${carrier} app.`;
  }
  
  if (status.includes('CONFIRMED') || status.includes('PLACED')) {
    return `Order confirmed, waiting for seller to ship. ${merchant} orders typically ship within 2-3 days. Expected delivery by ${eta}.`;
  }
  
  return `Package is being processed. Expected delivery by ${eta}. Track on ${merchant} for updates.`;
}

const PackageIcon = () => (
  <svg width="32" height="32" viewBox="0 0 64 64" fill="none">
    <path d="M10 20 L32 8 L54 20 L32 32 L10 20Z" fill="#FFC975" stroke="#101114" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M10 20 L10 44 L32 56 L32 32 L10 20Z" fill="#FFA841" stroke="#101114" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M54 20 L54 44 L32 56 L32 32 L54 20Z" fill="#E57C36" stroke="#101114" strokeWidth="2" strokeLinejoin="round"/>
  </svg>
);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const SyncIcon = ({ spinning }: { spinning?: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: spinning ? 'spin 1s linear infinite' : 'none' }}>
    <polyline points="23 4 23 10 17 10"></polyline>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'delivered'>('all');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { checkAuthStatus(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
      checkAuthStatus();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('auth') === 'error') {
      setError('Authentication failed. Please try again.');
      setIsLoading(false);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/status`, { credentials: 'include' });
      const data = await response.json();
      if (data.authenticated) {
        setIsAuthenticated(true);
        setUserEmail(data.email);
        await fetchShipments();
      }
    } catch (err) {
      setError('Failed to connect to server.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchShipments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/shipments`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const enriched = data.map((s: Shipment) => ({ ...s, category: detectCategory(s.itemName, s.merchant.name) }));
        setShipments(enriched);
        setError(null);
      }
    } catch (err) {
      setError('Failed to load shipments.');
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/shipments/refresh`, { method: 'POST', credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        const enriched = data.map((s: Shipment) => ({ ...s, category: detectCategory(s.itemName, s.merchant.name) }));
        setShipments(enriched);
      }
    } catch (err) {
      setError('Failed to refresh.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogin = () => { window.location.href = `${API_BASE_URL}/auth/google`; };
  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch { }
    setIsAuthenticated(false);
    setShipments([]);
  };

  const filteredShipments = shipments.filter(s => {
    const matchesSearch = !searchQuery || s.itemName.toLowerCase().includes(searchQuery.toLowerCase()) || s.trackingNumber.toLowerCase().includes(searchQuery.toLowerCase()) || s.carrier.toLowerCase().includes(searchQuery.toLowerCase()) || s.merchant.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filter === 'all' || (filter === 'active' && s.status !== 'DELIVERED') || (filter === 'delivered' && s.status === 'DELIVERED');
    return matchesSearch && matchesFilter;
  });

  const activeCount = shipments.filter(s => s.status !== 'DELIVERED').length;
  const deliveredCount = shipments.filter(s => s.status === 'DELIVERED').length;


  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f9fafb' }}>
        <div style={{ textAlign: 'center' }}>
          <PackageIcon />
          <p style={{ marginTop: '16px', color: '#6b7280' }}>Loading your packages...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(to bottom right, #fef3c7, #fde68a, #fbbf24)', padding: '24px' }}>
        <div style={{ maxWidth: '400px', width: '100%', background: 'white', borderRadius: '16px', padding: '48px 32px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
            <PackageIcon />
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: '600', color: '#111827', textAlign: 'center', marginBottom: '8px' }}>Where's My Stuff?</h1>
          <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '14px', marginBottom: '32px' }}>Track all your packages from Gmail in one beautiful place</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '32px' }}>
            {['Amazon', 'Flipkart', 'Myntra', 'Nykaa', 'Delhivery', 'BlueDart'].map(name => (
              <span key={name} style={{ padding: '4px 12px', fontSize: '12px', fontWeight: '500', background: brandConfig[name]?.gradient || '#f3f4f6', color: brandConfig[name]?.textColor || '#374151', borderRadius: '9999px' }}>{name}</span>
            ))}
          </div>
          {error && <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', marginBottom: '16px', color: '#991b1b', fontSize: '14px' }}>{error}</div>}
          <button onClick={handleLogin} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px 24px', background: '#111827', color: 'white', fontWeight: '500', fontSize: '15px', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
            <GoogleIcon /> Continue with Google
          </button>
          <p style={{ textAlign: 'center', fontSize: '12px', color: '#9ca3af', marginTop: '16px' }}>We only read shipping emails. Your data stays private.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      <header style={{ background: 'white', borderBottom: '1px solid #e5e7eb', padding: '12px 16px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: '56rem', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600', color: '#111827' }}>
            <PackageIcon />
            <span>Where's My Stuff?</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={handleRefresh} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '14px', fontWeight: '500', color: '#374151', background: '#f3f4f6', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>
              <SyncIcon spinning={isRefreshing} /> {isRefreshing ? 'Syncing...' : 'Sync'}
            </button>
            <div style={{ fontSize: '14px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>{userEmail}</span>
              <button onClick={handleLogout} style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}>Sign out</button>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '56rem', margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ position: 'relative', marginBottom: '16px' }}>
          <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }}>
            <SearchIcon />
          </div>
          <input type="text" placeholder="Search by product, order number, carrier..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '10px 16px 10px 40px', fontSize: '14px', border: '1px solid #e5e7eb', borderRadius: '8px', background: 'white', outline: 'none' }} />
        </div>

        <div style={{ display: 'flex', gap: '4px', background: '#f3f4f6', padding: '4px', borderRadius: '8px', width: 'fit-content', marginBottom: '24px' }}>
          <button onClick={() => setFilter('all')} style={{ padding: '6px 16px', fontSize: '14px', fontWeight: '500', color: filter === 'all' ? '#111827' : '#6b7280', background: filter === 'all' ? 'white' : 'none', border: 'none', borderRadius: '6px', cursor: 'pointer', boxShadow: filter === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>All <span style={{ marginLeft: '6px', fontSize: '12px', color: '#9ca3af' }}>{shipments.length}</span></button>
          <button onClick={() => setFilter('active')} style={{ padding: '6px 16px', fontSize: '14px', fontWeight: '500', color: filter === 'active' ? '#111827' : '#6b7280', background: filter === 'active' ? 'white' : 'none', border: 'none', borderRadius: '6px', cursor: 'pointer', boxShadow: filter === 'active' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>Active <span style={{ marginLeft: '6px', fontSize: '12px', color: '#9ca3af' }}>{activeCount}</span></button>
          <button onClick={() => setFilter('delivered')} style={{ padding: '6px 16px', fontSize: '14px', fontWeight: '500', color: filter === 'delivered' ? '#111827' : '#6b7280', background: filter === 'delivered' ? 'white' : 'none', border: 'none', borderRadius: '6px', cursor: 'pointer', boxShadow: filter === 'delivered' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>Delivered <span style={{ marginLeft: '6px', fontSize: '12px', color: '#9ca3af' }}>{deliveredCount}</span></button>
        </div>

        {error && <div style={{ padding: '12px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', marginBottom: '16px', color: '#991b1b', fontSize: '14px' }}>{error}</div>}

        {filteredShipments.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px 16px' }}>
            <PackageIcon />
            <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#111827', marginTop: '16px' }}>No packages found</h2>
            <p style={{ color: '#6b7280', marginTop: '8px', marginBottom: '16px' }}>{searchQuery ? 'Try a different search' : 'Click Sync to fetch from Gmail'}</p>
            <button onClick={handleRefresh} style={{ padding: '10px 20px', background: '#111827', color: 'white', fontWeight: '500', fontSize: '14px', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Sync Now</button>
          </div>
        ) : (
          <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            {filteredShipments.map((shipment, index) => (
              <ShipmentRow key={shipment.id} shipment={shipment} isExpanded={expandedId === shipment.id} onToggle={() => setExpandedId(expandedId === shipment.id ? null : shipment.id)} isLast={index === filteredShipments.length - 1} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ShipmentRow({ shipment, isExpanded, onToggle, isLast }: { shipment: Shipment; isExpanded: boolean; onToggle: () => void; isLast: boolean }) {
  const merchantBrand = brandConfig[shipment.merchant.name] || brandConfig.default;
  const carrierBrand = brandConfig[shipment.carrier] || brandConfig.default;
  const isDelivered = shipment.status === 'DELIVERED';
  const aiSummary = generateAISummary(shipment);
  
  const statusColor = isDelivered ? '#DEF7EC' : shipment.status.includes('OUT') || shipment.status.includes('DELIVERY') ? '#FDF6B2' : shipment.status.includes('TRANSIT') ? '#E1EFFE' : shipment.status.includes('FAIL') || shipment.status.includes('EXCEPTION') ? '#FDE8E8' : '#F3E8FF';
  const statusTextColor = isDelivered ? '#03543F' : shipment.status.includes('OUT') || shipment.status.includes('DELIVERY') ? '#723B13' : shipment.status.includes('TRANSIT') ? '#1E429F' : shipment.status.includes('FAIL') || shipment.status.includes('EXCEPTION') ? '#9B1C1C' : '#5B21B6';

  return (
    <div>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '16px', borderBottom: isLast && !isExpanded ? 'none' : '1px solid #f3f4f6', cursor: 'pointer', transition: 'background 0.15s', background: isExpanded ? '#fafafa' : 'white' }} onMouseEnter={(e) => e.currentTarget.style.background = '#fafafa'} onMouseLeave={(e) => e.currentTarget.style.background = isExpanded ? '#fafafa' : 'white'}>
        <div style={{ position: 'relative', width: '52px', height: '52px', flexShrink: 0 }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid #e5e7eb', position: 'absolute', top: 0, left: 0 }}>
            <img src={merchantBrand.logo || 'https://via.placeholder.com/44'} alt={shipment.merchant.name} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '8px' }} onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement!.style.background = merchantBrand.gradient; }} />
          </div>
          {shipment.carrier && (
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '2px solid white', boxShadow: '0 2px 4px rgba(0,0,0,0.15)', position: 'absolute', bottom: 0, right: 0 }}>
              <img src={carrierBrand.logo || 'https://via.placeholder.com/28'} alt={shipment.carrier} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement!.style.background = carrierBrand.gradient; }} />
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: '600', fontSize: '15px', color: '#111827', lineHeight: '1.3', marginBottom: '3px' }}>
            {shipment.itemName !== '! Package' ? shipment.itemName : shipment.rawSubject?.slice(0, 40) || 'Package'}
          </div>
          <div style={{ fontSize: '13px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span>{shipment.merchant.name}</span>
            {shipment.carrier && (
              <>
                <span style={{ color: '#d1d5db' }}>•</span>
                <span style={{ color: '#4b5563', fontWeight: '500' }}>{shipment.carrier}</span>
              </>
            )}
            {shipment.trackingNumber && (
              <>
                <span style={{ color: '#d1d5db' }}>•</span>
                <span>#{shipment.trackingNumber.slice(0, 12)}</span>
              </>
            )}
          </div>
          {aiSummary && (
            <div style={{ marginTop: '12px', padding: '10px 12px', background: 'linear-gradient(135deg, #f0f9ff 0%, #f5f3ff 100%)', borderRadius: '8px', fontSize: '13px', color: '#374151', lineHeight: '1.55', borderLeft: '3px solid #6366f1' }}>
              ✨ {aiSummary}
            </div>
          )}
          <div style={{ fontSize: '13px', color: '#9ca3af', marginTop: '8px' }}>
            {shipment.eta.date}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
          <span style={{ padding: '5px 12px', fontSize: '10px', fontWeight: '600', borderRadius: '9999px', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.03em', background: statusColor, color: statusTextColor }}>
            {shipment.statusLabel}
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#d1d5db', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>

      {isExpanded && (
        <div style={{ padding: '0 16px 16px 82px', background: '#fafafa', borderBottom: isLast ? 'none' : '1px solid #f3f4f6' }}>
          <div style={{ background: '#f9fafb', borderRadius: '8px', padding: '14px', border: '1px solid #f3f4f6' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '14px', fontSize: '13px' }}>
              <div>
                <div style={{ color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Tracking</div>
                <div style={{ color: '#111827', fontFamily: 'monospace', fontSize: '13px' }}>{shipment.trackingNumber}</div>
              </div>
              <div>
                <div style={{ color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Carrier</div>
                <div style={{ color: '#111827', fontSize: '13px' }}>{shipment.carrier || 'N/A'}</div>
              </div>
              <div>
                <div style={{ color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Status</div>
                <div style={{ color: '#111827', fontSize: '13px' }}>{shipment.statusLabel}</div>
              </div>
            </div>
            {shipment.trackingUrl && (
              <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '14px', fontSize: '13px', fontWeight: '500', color: '#2563eb', textDecoration: 'none' }}>
                Track on {shipment.carrier}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
