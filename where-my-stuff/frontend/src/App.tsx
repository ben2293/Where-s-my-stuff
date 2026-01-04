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
    logo: '/logos/ekart.png',
