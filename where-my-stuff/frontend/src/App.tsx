import { useState, useEffect } from 'react';
import { Package, Mail, LogOut, RefreshCw } from 'lucide-react';

interface PackageData {
  id: string;
  merchantName: string;
  orderNumber: string | null;
  carrier: string | null;
  status: string | null;
  productName: string | null;
  imageUrl: string;
  createdAt: string;
}

const statusColors: Record<string, { bg: string; text: string; icon: string }> = {
  'delivered': { bg: 'bg-green-50', text: 'text-green-700', icon: '✓' },
  'out for delivery': { bg: 'bg-blue-50', text: 'text-blue-700', icon: '🚚' },
  'in transit': { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: '📦' },
  'processing': { bg: 'bg-purple-50', text: 'text-purple-700', icon: '⚙️' },
};

export default function App() {
  const [user, setUser] = useState<{ email: string; name?: string } | null>(null);
  const [email, setEmail] = useState('');
  const [packages, setPackages] = useState<PackageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user_email');
    const storedName = localStorage.getItem('user_name');
    if (storedUser) {
      setUser({ email: storedUser, name: storedName || undefined });
      loadPackages(storedUser);
    }
  }, []);

  const loadPackages = async (userEmail: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/packages?email=${encodeURIComponent(userEmail)}`);
      const data = await response.json();
      setPackages(data);
    } catch (error) {
      console.error('Error loading packages:', error);
    }
    setLoading(false);
  };

  const handleSignIn = async () => {
    if (!email) return;
    setUser({ email });
    localStorage.setItem('user_email', email);
    setEmail('');
    await loadPackages(email);
  };

  const handleGoogleSignIn = async () => {
    try {
      // For now, we'll use a mock Google sign-in
      // In production, you'd integrate with @react-oauth/google or similar
      const mockGoogleUser = {
        email: 'user@gmail.com',
        name: 'Google User'
      };
      setUser(mockGoogleUser);
      localStorage.setItem('user_email', mockGoogleUser.email);
      localStorage.setItem('user_name', mockGoogleUser.name);
      await loadPackages(mockGoogleUser.email);
    } catch (error) {
      console.error('Google Sign-In error:', error);
    }
  };

  const handleSync = async () => {
    if (!user?.email) return;
    setSyncing(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulated sync
      await loadPackages(user.email);
    } catch (error) {
      console.error('Error syncing packages:', error);
    }
    setSyncing(false);
  };

  const handleLogout = () => {
    setUser(null);
    setPackages([]);
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_name');
  };

  const getStatusStyle = (status: string | null) => {
    if (!status) return statusColors['processing'];
    const lower = status.toLowerCase();
    for (const [key, value] of Object.entries(statusColors)) {
      if (lower.includes(key)) return value;
    }
    return statusColors['processing'];
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20"></div>
        </div>
        
        <div className="relative min-h-screen flex items-center justify-center px-4">
          <div className="w-full max-w-md">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl shadow-2xl p-8 border border-white/20">
              <div className="flex items-center justify-center mb-8">
                <div className="bg-blue-500 p-3 rounded-full">
                  <Package className="w-8 h-8 text-white" />
                </div>
              </div>
              
              <h1 className="text-3xl font-bold text-white text-center mb-2">Track Your Packages</h1>
              <p className="text-blue-100 text-center mb-8">Sign in to track your deliveries</p>
              
              <div className="space-y-4">
                {/* Google Sign In Button */}
                <button
                  onClick={handleGoogleSignIn}
                  className="w-full bg-white hover:bg-gray-100 text-gray-900 font-semibold py-3 rounded-lg transition-all duration-200 transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <text x="0" y="20" fontSize="20" fill="currentColor">G</text>
                  </svg>
                  Sign in with Google
                </button>

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/20"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white/50">Or with email</span>
                  </div>
                </div>

                {/* Email Sign In */}
                <div>
                  <label className="block text-sm font-medium text-blue-100 mb-2">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSignIn()}
                    placeholder="your@email.com"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                
                <button
                  onClick={handleSignIn}
                  className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold py-3 rounded-lg transition-all duration-200 transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
                >
                  <Mail className="w-5 h-5" />
                  Sign In
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-500 p-2 rounded-lg">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Package Tracker</h1>
              <p className="text-sm text-slate-500">Signed in as {user.name || user.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-blue-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync'}</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin mb-4">
                <Package className="w-12 h-12 text-blue-500 mx-auto" />
              </div>
              <p className="text-slate-600 font-medium">Loading your packages...</p>
            </div>
          </div>
        ) : packages.length === 0 ? (
          <div className="text-center py-12">
            <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 text-lg">No packages found</p>
            <p className="text-slate-500 text-sm mt-1">Your tracked packages will appear here</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {packages.map((pkg) => {
              const statusStyle = getStatusStyle(pkg.status);
              return (
                <div key={pkg.id} className="bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300 overflow-hidden border border-slate-200 hover:border-blue-300">
                  {/* Image */}
                  {pkg.imageUrl && (
                    <div className="h-48 bg-slate-100 overflow-hidden">
                      <img src={pkg.imageUrl} alt={pkg.productName || 'Package'} className="w-full h-full object-cover" />
                    </div>
                  )}
                  
                  {/* Content */}
                  <div className="p-5">
                    {/* Product Name */}
                    {pkg.productName && (
                      <h3 className="text-lg font-semibold text-slate-900 mb-2 line-clamp-2">{pkg.productName}</h3>
                    )}
                    
                    {/* Status Badge */}
                    <div className={`inline-block px-3 py-1 rounded-full text-sm font-medium mb-4 ${statusStyle.bg} ${statusStyle.text}`}>
                      {statusStyle.icon} {pkg.status || 'Unknown'}
                    </div>
                    
                    {/* Details */}
                    <div className="space-y-2 text-sm">
                      {pkg.merchantName && (
                        <div>
                          <p className="text-slate-500">Seller</p>
                          <p className="text-slate-900 font-medium">{pkg.merchantName}</p>
                        </div>
                      )}
                      
                      {pkg.orderNumber && (
                        <div>
                          <p className="text-slate-500">Order #</p>
                          <p className="text-slate-900 font-mono text-xs bg-slate-50 p-2 rounded break-all">{pkg.orderNumber}</p>
                        </div>
                      )}
                      
                      {pkg.carrier && (
                        <div>
                          <p className="text-slate-500">Carrier</p>
                          <p className="text-slate-900 font-medium">{pkg.carrier}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
