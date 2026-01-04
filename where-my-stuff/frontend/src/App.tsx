import { useState, useEffect } from 'react';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';

// ============================================
// ICONS
// ============================================
const PackageIcon = () => (
    <svg className="app-icon" width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
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

const SpinnerIcon = () => (
  <svg className="spinner-icon" viewBox="0 0 50 50">
    <circle className="path" cx="25" cy="25" r="20" fill="none" strokeWidth="5"></circle>
  </svg>
);

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const RefreshIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"></polyline>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
  </svg>
);

const LogoutIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
    <polyline points="16 17 21 12 16 7"></polyline>
    <line x1="21" y1="12" x2="9" y2="12"></line>
  </svg>
);

const ExternalLinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

// ============================================
// CARRIER LOGOS (Indian carriers)
// ============================================
const carrierColors: Record<string, string> = {
  Delhivery: '#E31837',
  DTDC: '#0066B3',
  BlueDart: '#003087',
  Ekart: '#2874F0',
  Xpressbees: '#FFC107',
  EcomExpress: '#FF6B00',
  Shadowfax: '#6B21A8',
  IndiaPost: '#E31837',
  Shiprocket: '#7C3AED',
  AmazonIndia: '#FF9900',
  Amazon: '#FF9900',
  Flipkart: '#2874F0',
  Myntra: '#FF3F6C',
  Meesho: '#570A57',
  UPS: '#351C15',
  FedEx: '#4D148C',
  DHL: '#FFCC00',
  USPS: '#004B87',
  Unknown: '#6B7280'
};

// ============================================
// TYPES
// ============================================
interface Shipment {
  id: string;
  itemName: string;
  itemImage: string;
  merchant: { name: string };
  status: string;
  statusLabel: string;
  eta: { label: string; date: string };
  orderNumber: string;
  trackingNumber: string;
  carrier: string;
  group: string;
  trackingUrl?: string;
}

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
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  // Check URL params for auth callback
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
      const response = await fetch(`${API_BASE_URL}/auth/status`, {
        credentials: 'include'
      });
      const data = await response.json();
      
      if (data.authenticated) {
        setIsAuthenticated(true);
        setUserEmail(data.email);
        await fetchShipments();
      } else {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      setError('Failed to connect to server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchShipments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/shipments`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setShipments(data);
        setError(null);
      } else if (response.status === 401) {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error('Failed to fetch shipments:', err);
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
        setShipments(data);
        setError(null);
      }
    } catch (err) {
      console.error('Failed to refresh:', err);
      setError('Failed to refresh shipments.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogin = () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (err) {
      console.error('Logout error:', err);
    }
    setIsAuthenticated(false);
    setUserEmail('');
    setShipments([]);
  };

  // Filter and search shipments
  const filteredShipments = shipments.filter(s => {
    const matchesSearch = searchQuery === '' || 
      s.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.trackingNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.carrier.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.merchant.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = filter === 'all' || 
      (filter === 'in-transit' && s.status === 'IN_TRANSIT') ||
      (filter === 'delivered' && s.status === 'DELIVERED') ||
      (filter === 'out-for-delivery' && s.status === 'OUT_FOR_DELIVERY');
    
    return matchesSearch && matchesFilter;
  });

  // Group shipments
  const groupedShipments = filteredShipments.reduce((acc, shipment) => {
    if (!acc[shipment.group]) {
      acc[shipment.group] = [];
    }
    acc[shipment.group].push(shipment);
    return acc;
  }, {} as Record<string, Shipment[]>);

  const groupOrder = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'];

  if (isLoading) {
    return (
      <div className="loading-screen">
        <PackageIcon />
        <SpinnerIcon />
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <PackageIcon />
          <h1>Where's My Stuff?</h1>
          <p>Track all your packages from Gmail in one place</p>
          <p className="subtitle">🇮🇳 Supports Delhivery, DTDC, BlueDart, Ekart & more</p>
          
          {error && <div className="error-message">{error}</div>}
          
          <button className="google-login-btn" onClick={handleLogin}>
            <GoogleIcon />
            <span>Sign in with Google</span>
          </button>
          
          <p className="privacy-note">
            We only read shipping-related emails. Your data stays private.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <PackageIcon />
          <h1>Where's My Stuff?</h1>
        </div>
        <div className="header-right">
          <button 
            className={`refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Sync from Gmail"
          >
            <RefreshIcon />
            {isRefreshing ? 'Syncing...' : 'Sync'}
          </button>
          <div className="user-info">
            <span>{userEmail}</span>
            <button className="logout-btn" onClick={handleLogout} title="Logout">
              <LogoutIcon />
            </button>
          </div>
        </div>
      </header>

      {/* Search and Filters */}
      <div className="controls">
        <div className="search-box">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search packages, carriers, or tracking numbers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="filters">
          <button 
            className={filter === 'all' ? 'active' : ''} 
            onClick={() => setFilter('all')}
          >
            All ({shipments.length})
          </button>
          <button 
            className={filter === 'in-transit' ? 'active' : ''} 
            onClick={() => setFilter('in-transit')}
          >
            In Transit ({shipments.filter(s => s.status === 'IN_TRANSIT').length})
          </button>
          <button 
            className={filter === 'out-for-delivery' ? 'active' : ''} 
            onClick={() => setFilter('out-for-delivery')}
          >
            Out for Delivery ({shipments.filter(s => s.status === 'OUT_FOR_DELIVERY').length})
          </button>
          <button 
            className={filter === 'delivered' ? 'active' : ''} 
            onClick={() => setFilter('delivered')}
          >
            Delivered ({shipments.filter(s => s.status === 'DELIVERED').length})
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && <div className="error-banner">{error}</div>}

      {/* Shipments List */}
      <main className="shipments-container">
        {filteredShipments.length === 0 ? (
          <div className="empty-state">
            <PackageIcon />
            <h2>No packages found</h2>
            <p>
              {searchQuery 
                ? 'Try a different search term' 
                : 'Click "Sync" to fetch packages from your Gmail'}
            </p>
            <button className="primary-btn" onClick={handleRefresh} disabled={isRefreshing}>
              {isRefreshing ? 'Syncing...' : 'Sync from Gmail'}
            </button>
          </div>
        ) : (
          groupOrder.map(group => {
            const groupShipments = groupedShipments[group];
            if (!groupShipments || groupShipments.length === 0) return null;
            
            return (
              <div key={group} className="shipment-group">
                <h2 className="group-title">{group}</h2>
                <div className="shipment-list">
                  {groupShipments.map(shipment => (
                    <ShipmentCard key={shipment.id} shipment={shipment} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}

// ============================================
// SHIPMENT CARD COMPONENT
// ============================================
function ShipmentCard({ shipment }: { shipment: Shipment }) {
  const statusClass = shipment.status.toLowerCase().replace('_', '-');
  const carrierColor = carrierColors[shipment.carrier] || carrierColors.Unknown;

  return (
    <div className={`shipment-card status-${statusClass}`}>
      <div className="shipment-main">
        <div className="shipment-icon">
          <div 
            className="carrier-badge" 
            style={{ backgroundColor: carrierColor }}
          >
            {shipment.carrier.substring(0, 2).toUpperCase()}
          </div>
        </div>
        <div className="shipment-details">
          <h3 className="item-name">{shipment.itemName}</h3>
          <p className="merchant">
            {shipment.merchant.name} • {shipment.carrier}
          </p>
          <p className="tracking-number">
            {shipment.trackingNumber}
            {shipment.trackingUrl && (
              <a 
                href={shipment.trackingUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="track-link"
                title="Track on carrier website"
              >
                <ExternalLinkIcon />
              </a>
            )}
          </p>
        </div>
        <div className="shipment-status">
          <span className={`status-badge ${statusClass}`}>
            {shipment.statusLabel}
          </span>
          <p className="eta">
            <span className="eta-label">{shipment.eta.label}</span>
            <span className="eta-date">{shipment.eta.date}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;iewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
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

const SpinnerIcon = () => (
  <svg className="spinner-icon" viewBox="0 0 50 50">
    <circle className="path" cx="25" cy="25" r="20" fill="none" strokeWidth="5"></circle>
  </svg>
);

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const RefreshIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"></polyline>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
  </svg>
);

const LogoutIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
    <polyline points="16 17 21 12 16 7"></polyline>
    <line x1="21" y1="12" x2="9" y2="12"></line>
  </svg>
);

const ExternalLinkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

// ============================================
// CARRIER LOGOS (Indian carriers)
// ============================================
const carrierColors: Record<string, string> = {
  Delhivery: '#E31837',
  DTDC: '#0066B3',
  BlueDart: '#003087',
  Ekart: '#2874F0',
  Xpressbees: '#FFC107',
  EcomExpress: '#FF6B00',
  Shadowfax: '#6B21A8',
  IndiaPost: '#E31837',
  Shiprocket: '#7C3AED',
  AmazonIndia: '#FF9900',
  Amazon: '#FF9900',
  Flipkart: '#2874F0',
  Myntra: '#FF3F6C',
  Meesho: '#570A57',
  UPS: '#351C15',
  FedEx: '#4D148C',
  DHL: '#FFCC00',
  USPS: '#004B87',
  Unknown: '#6B7280'
};

// ============================================
// TYPES
// ============================================
interface Shipment {
  id: string;
  itemName: string;
  itemImage: string;
  merchant: { name: string };
  status: string;
  statusLabel: string;
  eta: { label: string; date: string };
  orderNumber: string;
  trackingNumber: string;
  carrier: string;
  group: string;
  trackingUrl?: string;
}

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
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);

  // Check auth status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  // Check URL params for auth callback
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
      const response = await fetch(`${API_BASE_URL}/auth/status`, {
        credentials: 'include'
      });
      const data = await response.json();
      
      if (data.authenticated) {
        setIsAuthenticated(true);
        setUserEmail(data.email);
        await fetchShipments();
      } else {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      setError('Failed to connect to server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchShipments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/shipments`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        setShipments(data);
        setError(null);
      } else if (response.status === 401) {
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error('Failed to fetch shipments:', err);
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
        setShipments(data);
        setError(null);
      }
    } catch (err) {
      console.error('Failed to refresh:', err);
      setError('Failed to refresh shipments.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogin = () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (err) {
      console.error('Logout error:', err);
    }
    setIsAuthenticated(false);
    setUserEmail('');
    setShipments([]);
  };

  // Filter and search shipments
  const filteredShipments = shipments.filter(s => {
    const matchesSearch = searchQuery === '' || 
      s.itemName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.trackingNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.carrier.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.merchant.name.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesFilter = filter === 'all' || 
      (filter === 'in-transit' && s.status === 'IN_TRANSIT') ||
      (filter === 'delivered' && s.status === 'DELIVERED') ||
      (filter === 'out-for-delivery' && s.status === 'OUT_FOR_DELIVERY');
    
    return matchesSearch && matchesFilter;
  });

  // Group shipments
  const groupedShipments = filteredShipments.reduce((acc, shipment) => {
    if (!acc[shipment.group]) {
      acc[shipment.group] = [];
    }
    acc[shipment.group].push(shipment);
    return acc;
  }, {} as Record<string, Shipment[]>);

  const groupOrder = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'];

  if (isLoading) {
    return (
      <div className="loading-screen">
        <PackageIcon />
        <SpinnerIcon />
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <PackageIcon />
          <h1>Where's My Stuff?</h1>
          <p>Track all your packages from Gmail in one place</p>
          <p className="subtitle">🇮🇳 Supports Delhivery, DTDC, BlueDart, Ekart & more</p>
          
          {error && <div className="error-message">{error}</div>}
          
          <button className="google-login-btn" onClick={handleLogin}>
            <GoogleIcon />
            <span>Sign in with Google</span>
          </button>
          
          <p className="privacy-note">
            We only read shipping-related emails. Your data stays private.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <PackageIcon />
          <h1>Where's My Stuff?</h1>
        </div>
        <div className="header-right">
          <button 
            className={`refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Sync from Gmail"
          >
            <RefreshIcon />
            {isRefreshing ? 'Syncing...' : 'Sync'}
          </button>
          <div className="user-info">
            <span>{userEmail}</span>
            <button className="logout-btn" onClick={handleLogout} title="Logout">
              <LogoutIcon />
            </button>
          </div>
        </div>
      </header>

      {/* Search and Filters */}
      <div className="controls">
        <div className="search-box">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search packages, carriers, or tracking numbers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="filters">
          <button 
            className={filter === 'all' ? 'active' : ''} 
            onClick={() => setFilter('all')}
          >
            All ({shipments.length})
          </button>
          <button 
            className={filter === 'in-transit' ? 'active' : ''} 
            onClick={() => setFilter('in-transit')}
          >
            In Transit ({shipments.filter(s => s.status === 'IN_TRANSIT').length})
          </button>
          <button 
            className={filter === 'out-for-delivery' ? 'active' : ''} 
            onClick={() => setFilter('out-for-delivery')}
          >
            Out for Delivery ({shipments.filter(s => s.status === 'OUT_FOR_DELIVERY').length})
          </button>
          <button 
            className={filter === 'delivered' ? 'active' : ''} 
            onClick={() => setFilter('delivered')}
          >
            Delivered ({shipments.filter(s => s.status === 'DELIVERED').length})
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && <div className="error-banner">{error}</div>}

      {/* Shipments List */}
      <main className="shipments-container">
        {filteredShipments.length === 0 ? (
          <div className="empty-state">
            <PackageIcon />
            <h2>No packages found</h2>
            <p>
              {searchQuery 
                ? 'Try a different search term' 
                : 'Click "Sync" to fetch packages from your Gmail'}
            </p>
            <button className="primary-btn" onClick={handleRefresh} disabled={isRefreshing}>
              {isRefreshing ? 'Syncing...' : 'Sync from Gmail'}
            </button>
          </div>
        ) : (
          groupOrder.map(group => {
            const groupShipments = groupedShipments[group];
            if (!groupShipments || groupShipments.length === 0) return null;
            
            return (
              <div key={group} className="shipment-group">
                <h2 className="group-title">{group}</h2>
                <div className="shipment-list">
                  {groupShipments.map(shipment => (
                    <ShipmentCard key={shipment.id} shipment={shipment} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}

// ============================================
// SHIPMENT CARD COMPONENT
// ============================================
function ShipmentCard({ shipment }: { shipment: Shipment }) {
  const statusClass = shipment.status.toLowerCase().replace('_', '-');
  const carrierColor = carrierColors[shipment.carrier] || carrierColors.Unknown;

  return (
    <div className={`shipment-card status-${statusClass}`}>
      <div className="shipment-main">
        <div className="shipment-icon">
          <div 
            className="carrier-badge" 
            style={{ backgroundColor: carrierColor }}
          >
            {shipment.carrier.substring(0, 2).toUpperCase()}
          </div>
        </div>
        <div className="shipment-details">
          <h3 className="item-name">{shipment.itemName}</h3>
          <p className="merchant">
            {shipment.merchant.name} • {shipment.carrier}
          </p>
          <p className="tracking-number">
            {shipment.trackingNumber}
            {shipment.trackingUrl && (
              <a 
                href={shipment.trackingUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="track-link"
                title="Track on carrier website"
              >
                <ExternalLinkIcon />
              </a>
            )}
          </p>
        </div>
        <div className="shipment-status">
          <span className={`status-badge ${statusClass}`}>
            {shipment.statusLabel}
          </span>
          <p className="eta">
            <span className="eta-label">{shipment.eta.label}</span>
            <span className="eta-date">{shipment.eta.date}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
