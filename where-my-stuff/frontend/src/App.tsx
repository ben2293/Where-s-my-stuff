import { useState, useEffect } from 'react';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';

// ============================================
// TYPES
// ============================================
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

// ============================================
// BRAND CONFIGURATIONS
// ============================================
const brandConfig: Record<string, { gradient: string; logo: string; textColor: string }> = {
  'Amazon India': {
    gradient: 'linear-gradient(135deg, #FF9900 0%, #FFB347 100%)',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg',
    textColor: '#232F3E',
  },
  Amazon: {
    gradient: 'linear-gradient(135deg, #FF9900 0%, #FFB347 100%)',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg',
    textColor: '#232F3E',
  },
  Flipkart: {
    gradient: 'linear-gradient(135deg, #2874F0 0%, #5B9CF6 100%)',
    logo: 'https://logos-world.net/wp-content/uploads/2020/11/Flipkart-Emblem.png',
    textColor: '#FFFFFF',
  },
  Myntra: {
    gradient: 'linear-gradient(135deg, #FF3F6C 0%, #FF6B8A 100%)',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/b/b3/Myntra_logo.png',
    textColor: '#FFFFFF',
  },
  Nykaa: {
    gradient: 'linear-gradient(135deg, #FC2779 0%, #FF6BA3 100%)',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/9/9e/Nykaa_Logo.svg',
    textColor: '#FFFFFF',
  },
  Meesho: {
    gradient: 'linear-gradient(135deg, #570A57 0%, #8B1A8B 100%)',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/0/0f/Meesho_Logo.svg',
    textColor: '#FFFFFF',
  },
  AJIO: {
    gradient: 'linear-gradient(135deg, #4A4A4A 0%, #6B6B6B 100%)',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/1/14/AJIO_Logo.svg',
    textColor: '#FFFFFF',
  },
  Delhivery: {
    gradient: 'linear-gradient(135deg, #E31837 0%, #FF4D6A 100%)',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/4/4c/Delhivery_Logo.svg',
    textColor: '#FFFFFF',
  },
  BlueDart: {
    gradient: 'linear-gradient(135deg, #003087 0%, #0052CC 100%)',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/5/5d/BlueDart_Logo.svg',
    textColor: '#FFFFFF',
  },
  DTDC: {
    gradient: 'linear-gradient(135deg, #0066B3 0%, #3399E6 100%)',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/e/e4/DTDC_Logo.svg',
    textColor: '#FFFFFF',
  },
  Ekart: {
    gradient: 'linear-gradient(135deg, #2874F0 0%, #5B9CF6 100%)',
    logo: '',
    textColor: '#FFFFFF',
  },
  default: {
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    logo: '',
    textColor: '#FFFFFF',
  },
};

// Contextual images based on product category
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

// Detect category from item name
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

// ============================================
// ICONS
// ============================================
const PackageIcon = () => (
  <svg width="32" height="32" viewBox="0 0 64 64" fill="none">
    <path d="M10 20 L32 8 L54 20 L32 32 L10 20Z" fill="#FFC975" stroke="#101114" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M10 20 L10 44 L32 56 L32 32 L10 20Z" fill="#FFA841" stroke="#101114" strokeWidth="2" strokeLinejoin="round"/>
    <path d="M54 20 L54 44 L32 56 L32 32 L54 20Z" fill="#E57C36" stroke="#101114" strokeWidth="2" strokeLinejoin="round"/>
  </svg>
);

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const SyncIcon = ({ spinning }: { spinning?: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: spinning ? 'spin 1s linear infinite' : 'none' }}>
    <polyline points="23 4 23 10 17 10"></polyline>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
  </svg>
);

const SearchIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const ExternalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

const CheckCircleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
    <polyline points="22 4 12 14.01 9 11.01"></polyline>
  </svg>
);

const TruckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="1" y="3" width="15" height="13"></rect>
    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
    <circle cx="5.5" cy="18.5" r="2.5"></circle>
    <circle cx="18.5" cy="18.5" r="2.5"></circle>
  </svg>
);

// ============================================
// MAIN APP
// ============================================
function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'delivered'>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkAuthStatus();
  }, []);

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
        const enriched = data.map((s: Shipment) => ({
          ...s,
          category: detectCategory(s.itemName, s.merchant.name)
        }));
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
      const response = await fetch(`${API_BASE_URL}/api/shipments/refresh`, {
        method: 'POST',
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        const enriched = data.map((s: Shipment) => ({
          ...s,
          category: detectCategory(s.itemName, s.merchant.name)
        }));
        setShipments(enriched);
      }
    } catch (err) {
      setError('Failed to refresh.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogin = () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch { }
    setIsAuthenticated(false);
    setShipments([]);
  };

  const filteredShipments = shipments.filter(s => {
    const matchesSearch = !searchQuery || 
      s.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.trackingNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.carrier.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.merchant.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = 
      filter === 'all' ||
      (filter === 'active' && s.status !== 'DELIVERED') ||
      (filter === 'delivered' && s.status === 'DELIVERED');
    
    return matchesSearch && matchesFilter;
  });

  const activeCount = shipments.filter(s => s.status !== 'DELIVERED').length;
  const deliveredCount = shipments.filter(s => s.status === 'DELIVERED').length;

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <PackageIcon />
          <div className="loading-spinner"><div /></div>
          <p>Loading your packages...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-header">
            <PackageIcon />
            <h1>Where's My Stuff?</h1>
            <p>Track all your packages from Gmail in one beautiful place</p>
          </div>

          <div className="carriers-preview">
            <span className="carrier-tag amazon">Amazon</span>
            <span className="carrier-tag flipkart">Flipkart</span>
            <span className="carrier-tag myntra">Myntra</span>
            <span className="carrier-tag nykaa">Nykaa</span>
            <span className="carrier-tag delhivery">Delhivery</span>
            <span className="carrier-tag bluedart">BlueDart</span>
          </div>

          {error && <div className="error-toast">{error}</div>}

          <button className="google-btn" onClick={handleLogin}>
            <GoogleIcon />
            <span>Continue with Google</span>
          </button>

          <p className="privacy-text">
            We only read shipping emails. Your data stays private.
          </p>
        </div>

        <div className="login-decoration">
          <div className="floating-card card-1"></div>
          <div className="floating-card card-2"></div>
          <div className="floating-card card-3"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <PackageIcon />
          <span className="brand-name">Where's My Stuff?</span>
        </div>

        <div className="header-actions">
          <button className="sync-btn" onClick={handleRefresh} disabled={isRefreshing}>
            <SyncIcon spinning={isRefreshing} />
            <span>{isRefreshing ? 'Syncing...' : 'Sync'}</span>
          </button>

          <div className="user-menu">
            <span className="user-email">{userEmail}</span>
            <button className="logout-btn" onClick={handleLogout}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="search-section">
        <div className="search-input-wrapper">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search packages, brands, tracking..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      <div className="filter-tabs">
        <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All <span className="tab-count">{shipments.length}</span>
        </button>
        <button className={`tab ${filter === 'active' ? 'active' : ''}`} onClick={() => setFilter('active')}>
          Active <span className="tab-count">{activeCount}</span>
        </button>
        <button className={`tab ${filter === 'delivered' ? 'active' : ''}`} onClick={() => setFilter('delivered')}>
          Delivered <span className="tab-count">{deliveredCount}</span>
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <main className="shipments-grid">
        {filteredShipments.length === 0 ? (
          <div className="empty-state">
            <PackageIcon />
            <h2>No packages found</h2>
            <p>{searchQuery ? 'Try a different search' : 'Click Sync to fetch from Gmail'}</p>
            <button className="primary-btn" onClick={handleRefresh}>
              <SyncIcon /> Sync Now
            </button>
          </div>
        ) : (
          filteredShipments.map(shipment => (
            <ShipmentCard key={shipment.id} shipment={shipment} />
          ))
        )}
      </main>
    </div>
  );
}

// ============================================
// SHIPMENT CARD COMPONENT
// ============================================
function ShipmentCard({ shipment }: { shipment: Shipment }) {
  const brand = brandConfig[shipment.merchant.name] || brandConfig[shipment.carrier] || brandConfig.default;
  const categoryImage = categoryImages[shipment.category || 'default'] || categoryImages.default;
  const isDelivered = shipment.status === 'DELIVERED';

  return (
    <div className="shipment-card" style={{ background: brand.gradient }}>
      <div className="card-image">
        <img src={categoryImage} alt="" loading="lazy" />
        <div className="card-image-overlay"></div>
      </div>

      <div className="card-content">
        <h3 className="card-title" style={{ color: brand.textColor }}>
          {shipment.itemName !== '! Package' ? shipment.itemName : shipment.rawSubject?.slice(0, 40) || 'Package'}
        </h3>

        <div className="card-meta">
          <span className="merchant-name">{shipment.merchant.name}</span>
          <span className="carrier-name">via {shipment.carrier}</span>
        </div>
      </div>

      <div className="card-footer">
        <div className="delivery-info">
          <div className={`status-indicator ${isDelivered ? 'delivered' : 'active'}`}>
            {isDelivered ? <CheckCircleIcon /> : <TruckIcon />}
            <span>{shipment.statusLabel}</span>
          </div>
          <div className="eta-text">{shipment.eta.date}</div>
        </div>

        {shipment.trackingUrl && (
          <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="track-btn">
            Track <ExternalIcon />
          </a>
        )}
      </div>

      <div className="tracking-number">{shipment.trackingNumber}</div>
    </div>
  );
}

export default App;
