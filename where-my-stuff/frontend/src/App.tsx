import React, { useState, useEffect } from 'react';
// Rebuilt with fresh dependencies - v2
import { Package, Upload, LogOut, X, Trash2 } from 'lucide-react';

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

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [packages, setPackages] = useState<PackageData[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
   const [emailSubject, setEmailSubject] = useState('');
 const [emailBody, setEmailBody] = useState('');
 const [emailOrderNumber, setEmailOrderNumber] = useState('');

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (user) {
      loadPackages();
    }
  }, [user]);

  const loadUser = async () => {
    const storedUser = localStorage.getItem('user_email');
    if (storedUser) {
      setUser(storedUser);
    }
  };

  const loadPackages = async () => {
    const storedPackages = localStorage.getItem(`packages_${user}`);
    if (storedPackages) {
      setPackages(JSON.parse(storedPackages));
    }
  };

  const savePackages = (pkgs: PackageData[]) => {
    localStorage.setItem(`packages_${user}`, JSON.stringify(pkgs));
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) {
      setUser(email);
      localStorage.setItem('user_email', email);
    }
  };

  const handleLogout = () => {
    if (confirm('Are you sure you want to logout?')) {
      setUser(null);
      setPackages([]);
      localStorage.removeItem('user_email');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/parse-package', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Failed to parse image');
      }

      const packageData = await response.json();
      const imageUrl = URL.createObjectURL(file);

      const newPackage: PackageData = {
        id: Date.now().toString(),
        merchantName: packageData.merchantName || 'Unknown Merchant',
        orderNumber: packageData.orderNumber || null,
        carrier: packageData.carrier || null,
        status: packageData.status || null,
         productName: null,
        imageUrl,
        createdAt: new Date().toISOString(),
      };

      const updatedPackages = [newPackage, ...packages];
      setPackages(updatedPackages);
      savePackages(updatedPackages);
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to process image. Please try again.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const deletePackage = (id: string) => {
    const updatedPackages = packages.filter((pkg) => pkg.id !== id);
    setPackages(updatedPackages);
    savePackages(updatedPackages);
  };

   const handleEmailParse = async () => {
 try {
 if (!emailSubject.trim() && !emailBody.trim()) {
 alert('Please enter email subject or body');
 return;
 }
 const response = await fetch('/api/parse-email', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({
 subject: emailSubject,
 body: emailBody,
 orderNumber: emailOrderNumber || null,
 }),
 });
 if (!response.ok) throw new Error('Failed to parse email');
 const { status } = await response.json();
 const newPackage: PackageData = {
 id: Date.now().toString(),
 merchantName: 'Email Import',
 orderNumber: emailOrderNumber || null,
 carrier: null,
 status: status || 'Unknown',
 productName: emailBody.match(/(?:Item|Product|Product Name):?\s*([^\n,]+)/i)?.[1]?.trim() || null,
 imageUrl: '',
 createdAt: new Date().toISOString(),
 };
 const updatedPackages = [newPackage, ...packages];
 setPackages(updatedPackages);
 savePackages(updatedPackages);
 setEmailSubject('');
 setEmailBody('');
 setEmailOrderNumber('');
 alert('Email parsed successfully!');
 } catch (error) {
 console.error('Email parse failed:', error);
 alert('Failed to parse email. Please try again.');
 }
 };

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <Package className="w-16 h-16 text-blue-400 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-white mb-2">Package Tracker</h1>
            <p className="text-gray-400">Sign in to track your deliveries</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white">
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Package className="w-8 h-8 text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold">Package Tracker</h1>
              <p className="text-sm text-gray-400">{user}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>

        <div className="mb-8">
          <label className="flex items-center justify-center gap-3 px-6 py-4 bg-blue-600 hover:bg-blue-700 rounded-xl cursor-pointer transition-colors">
            <Upload className="w-5 h-5" />
            <span className="font-semibold">
              {uploading ? 'Processing...' : 'Upload Package Screenshot'}
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
        </div>

         <div className="mb-8 p-6 bg-gray-800/50 rounded-xl">
 <h2 className="text-xl font-bold mb-4">Or Parse From Email</h2>
 <div className="space-y-4">
 <textarea
 value={emailSubject}
 onChange={(e) => setEmailSubject(e.target.value)}
 placeholder="Paste email subject here..."
 className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 h-12"
 />
 <textarea
 value={emailBody}
 onChange={(e) => setEmailBody(e.target.value)}
 placeholder="Paste email body here..."
 className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 h-32"
 />
 <input
 type="text"
 value={emailOrderNumber}
 onChange={(e) => setEmailOrderNumber(e.target.value)}
 placeholder="Order Number (optional)"
 className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
 />
 <button
 onClick={handleEmailParse}
 className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition-colors"
 >
 Parse Email
 </button>
 </div>
 </div>

        {packages.length === 0 ? (
          <div className="text-center py-16">
            <Package className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-lg">No packages yet</p>
            <p className="text-gray-500 text-sm mt-2">Upload a screenshot to get started</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {packages.map((pkg) => (
              <div key={pkg.id} className="border border-gray-700 rounded-lg p-4 bg-gray-800/50">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Package className="w-5 h-5 text-blue-400" />
                      <h3 className="font-semibold text-lg">{pkg.merchantName}</h3>
                    </div>
                     {pkg.productName && (
 <p className="text-sm text-gray-300 mb-1">📦 {pkg.productName}</p>
 )}
                    {pkg.orderNumber && (
                      <p className="text-sm text-gray-400 mb-2">Order: {pkg.orderNumber}</p>
                    )}
                    <p className="text-sm text-gray-400">
                      {new Date(pkg.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => deletePackage(pkg.id)}
                    className="text-red-400 hover:text-red-300 transition-colors"
                    title="Delete package"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  {pkg.carrier && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                        Carrier
                      </p>
                      <p className="text-sm font-medium">{pkg.carrier}</p>
                    </div>
                  )}
                  {pkg.status && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                        Status
                      </p>
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                          pkg.status.toLowerCase().includes('delivered')
                            ? 'bg-green-900/50 text-green-300'
                            : pkg.status.toLowerCase().includes('processing')
                            ? 'bg-yellow-900/50 text-yellow-300'
                            : 'bg-blue-900/50 text-blue-300'
                        }`}
                      >
                        {pkg.status}
                      </span>
                    </div>
                  )}
                </div>

                {pkg.imageUrl && (
                  <img
                    src={pkg.imageUrl}
                    alt={pkg.merchantName}
                    className="w-full h-48 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setSelectedImage(pkg.imageUrl)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedImage(null)}
        >
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 text-white hover:text-gray-300"
          >
            <X className="w-8 h-8" />
          </button>
          <img
            src={selectedImage}
            alt="Package details"
            className="max-w-full max-h-full object-contain"
          />
        </div>
      )}
    </div>
  );
}
