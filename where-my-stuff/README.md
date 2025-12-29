# 📦 Where's My Stuff?

A Gmail-based package tracker that automatically detects and tracks your shipments. **Built for India** with priority support for Indian carriers like Delhivery, DTDC, BlueDart, Ekart, and more.

![Package Tracker](https://i.imgur.com/gK42D75.png)

## ✨ Features

- 🔐 **Secure Google OAuth** - Sign in with Gmail, we only read shipping emails
- 🇮🇳 **Indian Carriers First** - Delhivery, DTDC, BlueDart, Ekart, Xpressbees, Shadowfax, India Post
- 🛒 **Indian E-commerce** - Flipkart, Amazon India, Myntra, Meesho, AJIO, Nykaa
- 🌍 **International Support** - UPS, FedEx, DHL, USPS
- 💰 **100% Free** - Zero API costs, uses free tiers only
- 🔄 **Auto-sync** - Fetches tracking from your Gmail
- 📱 **Responsive** - Works on desktop and mobile

## 🚀 Supported Carriers

### Indian Carriers (Priority)
| Carrier | Tracking Format | Status |
|---------|----------------|--------|
| Delhivery | 13-14 digit AWB | ✅ |
| DTDC | Letter + 8-9 digits | ✅ |
| BlueDart | 11 digit AWB | ✅ |
| Ekart (Flipkart) | FMPC + digits | ✅ |
| Xpressbees | XB + digits | ✅ |
| Ecom Express | 10-12 digits | ✅ |
| Shadowfax | SF + digits | ✅ |
| India Post | EMS/Speed Post | ✅ |
| Shiprocket | Various | ✅ |

### International Carriers
| Carrier | Tracking Format | Status |
|---------|----------------|--------|
| UPS | 1Z + 16 chars | ✅ |
| FedEx | 12-20 digits | ✅ |
| DHL | 10-11 digits | ✅ |
| USPS | 20+ digits | ✅ |
| Amazon | TBA + 12 digits | ✅ |

## 📋 Prerequisites

- Node.js 18+ 
- Google Cloud account (free)
- GitHub account
- Vercel account (free)
- Render.com account (free)

## 🛠️ Local Development Setup

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/where-my-stuff.git
cd where-my-stuff
```

### 2. Set up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the Gmail API:
   - Go to "APIs & Services" → "Library"
   - Search "Gmail API" → Enable
4. Create OAuth credentials:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth 2.0 Client ID"
   - Application type: "Web application"
   - Name: "Where's My Stuff"
   - Authorized redirect URIs: `http://localhost:3001/auth/google/callback`
5. Download credentials (Client ID and Secret)

### 3. Configure Backend

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

Your `.env` should look like:
```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
SESSION_SECRET=your_random_32_char_secret
FRONTEND_URL=http://localhost:3000
NODE_ENV=development
```

Generate secrets:
```bash
# Session secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex').substring(0, 32))"
```

### 4. Configure Frontend

```bash
cd ../frontend

# Install dependencies
npm install

# Create .env.local
echo "VITE_API_URL=http://localhost:3001" > .env.local
```

### 5. Run Locally

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Visit `http://localhost:3000` and sign in with Google!

## 🚀 Production Deployment

### Deploy Backend to Render.com (Free)

1. Push code to GitHub
2. Go to [Render.com](https://render.com) → New → Web Service
3. Connect your GitHub repo
4. Configure:
   - **Name**: `where-my-stuff-api`
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Add Environment Variables:
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_secret
   GOOGLE_REDIRECT_URI=https://where-my-stuff-api.onrender.com/auth/google/callback
   SESSION_SECRET=your_production_secret
   FRONTEND_URL=https://your-app.vercel.app
   NODE_ENV=production
   ENCRYPTION_KEY=your_32_char_key
   ```
6. Deploy!

### Deploy Frontend to Vercel (Free)

1. Go to [Vercel](https://vercel.com) → Import Project
2. Connect your GitHub repo
3. Configure:
   - **Root Directory**: `frontend`
   - **Framework**: Vite
4. Add Environment Variable:
   ```
   VITE_API_URL=https://where-my-stuff-api.onrender.com
   ```
5. Deploy!

### Update Google OAuth

Add production redirect URI to Google Cloud Console:
```
https://where-my-stuff-api.onrender.com/auth/google/callback
```

## 💰 Cost Breakdown

| Service | Cost |
|---------|------|
| Google Cloud (Gmail API) | $0 (free tier) |
| Render.com (backend) | $0 (free tier) |
| Vercel (frontend) | $0 (free tier) |
| SQLite database | $0 (file-based) |
| **Total** | **$0/month** |

## 🔒 Security

- ✅ OAuth tokens encrypted in database
- ✅ HTTPS in production
- ✅ Secure session cookies
- ✅ No API keys in frontend
- ✅ CORS restricted to your domain
- ✅ Only reads shipping-related emails

## 📝 How It Works

1. **Sign In**: OAuth redirects to Google, gets Gmail read access
2. **Sync**: Backend searches Gmail for shipping emails (last 90 days)
3. **Parse**: Extracts tracking numbers using carrier-specific patterns
4. **Store**: Saves to SQLite database (deduped by tracking number)
5. **Display**: Frontend fetches and shows your packages
6. **Track**: Click tracking link to view on carrier website

## 🐛 Troubleshooting

**"No packages found"**
- Click "Sync" to fetch from Gmail
- Check you have shipping emails in last 90 days
- Try signing out and in again

**"Authentication failed"**
- Verify Google OAuth credentials
- Check redirect URI matches exactly
- Clear browser cookies

**Backend sleeping (Render free tier)**
- First request takes 30-60 seconds
- Normal for free tier

## 🤝 Contributing

1. Fork the repo
2. Create feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open Pull Request

## 📄 License

MIT License - feel free to use for personal or commercial projects.

## 🙏 Credits

Built with ❤️ for tracking packages in India.

---

**Made by Ben** | [Report Issues](https://github.com/yourusername/where-my-stuff/issues)
