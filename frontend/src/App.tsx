import React, { useState } from 'react';
import { 
  MapPin, 
  Calendar, 
  Sparkles, 
  Clock, 
  Compass, 
  DollarSign, 
  AlertCircle, 
  Check,
  Plane,
  Hotel,
  ArrowRight,
  Send
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icon issue in Leaflet + Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Type definitions matching backend schema
interface ActivityItem {
  type?: "attraction" | "restaurant" | string;
  time_slot: string;
  location_name: string;
  description: string;
  activity_type: string;
  estimated_cost_usd: number;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  verified_address?: string;
  place_id?: string;
}

interface TransitSegmentItem {
  type: "transit_segment";
  mode: "transit" | "pedestrian" | "walking_fallback" | "unknown";
  duration_minutes: number;
  distance_meters: number;
  line_name: string;
  step_by_step: string[];
}

type ActivityOrTransit = ActivityItem | TransitSegmentItem;

interface DayPlan {
  day: number;
  theme: string;
  activities: ActivityOrTransit[];
}

interface SuggestedFlight {
  carrier: string;
  carrier_name?: string;
  duration: string;
  total_price_eur: string;
  currency: string;
}

interface SuggestedHotel {
  hotel_name: string;
  hotel_id: string;
  chain_code: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
}

interface LogisticsPayload {
  destination_city_code: string;
  logistics: {
    suggested_flights: SuggestedFlight[];
    suggested_hotels: SuggestedHotel[];
  };
}

interface MapComponentProps {
  activities: ActivityOrTransit[];
  highlightedVenue: string | null;
}

function MapComponent({ activities, highlightedVenue }: MapComponentProps) {
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const markersRef = React.useRef<L.Marker[]>([]);
  const polylinesRef = React.useRef<L.Polyline[]>([]);

  // 1. Initialize Map
  React.useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: true
    }).setView([35.6895, 139.6917], 13); // Default center (Tokyo)

    // Load CartoDB Dark Matter tile layer for an elegant, premium dark aesthetics match
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }).addTo(map);

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 2. Render Markers, draw connecting polylines, and adjust zoom bounds
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing markers from map
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Clear existing polylines from map
    polylinesRef.current.forEach(p => p.remove());
    polylinesRef.current = [];

    const validCoords: [number, number][] = [];

    activities.forEach((act) => {
      // Ignore transit segments for drawing marker pins
      if ('type' in act && act.type === 'transit_segment') return;

      const attraction = act as ActivityItem;
      if (attraction.coordinates && attraction.coordinates.latitude && attraction.coordinates.longitude) {
        const lat = attraction.coordinates.latitude;
        const lng = attraction.coordinates.longitude;
        validCoords.push([lat, lng]);

        const isHighlighted = highlightedVenue === attraction.location_name;

        // Custom stylized Leaflet popup
        const marker = L.marker([lat, lng]).addTo(map);
        marker.bindPopup(`
          <div style="font-family: var(--font-sans); color: white;">
            <strong style="color: #6366F1; font-size: 0.95rem; font-weight: 700;">${attraction.location_name}</strong>
            <div style="font-weight: 600; margin-top: 0.25rem; font-size: 0.8rem; color: #67E8F9;">🕒 ${attraction.time_slot}</div>
            <div style="font-size: 0.75rem; color: #9CA3AF; margin-top: 0.25rem; line-height: 1.3;">📍 ${attraction.verified_address || 'Address unavailable'}</div>
          </div>
        `, { closeButton: false });

        if (isHighlighted) {
          marker.openPopup();
        }

        markersRef.current.push(marker);
      }
    });

    // Draw dashed connecting path between consecutive attraction markers
    if (validCoords.length > 1) {
      const path = L.polyline(validCoords, {
        color: '#06B6D4',
        dashArray: '8, 12',
        weight: 3,
        opacity: 0.8
      }).addTo(map);
      
      polylinesRef.current.push(path);
    }

    // Fit map bounds to encompass active day activities dynamically
    if (validCoords.length > 1) {
      const bounds = L.latLngBounds(validCoords);
      map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 1.0 });
    } else if (validCoords.length === 1) {
      map.setView(validCoords[0], 14, { animate: true });
    }

    // Trigger invalidateSize to adjust Leaflet display bounds properly on render delays
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => clearTimeout(timer);
  }, [activities, highlightedVenue]);

  return (
    <div className="map-wrapper">
      <div ref={mapContainerRef} className="map-container" />
    </div>
  );
}

interface TransitBridgeProps {
  transit: TransitSegmentItem;
}

function TransitBridge({ transit }: TransitBridgeProps) {
  const [expanded, setExpanded] = useState(false);
  const isWalking = transit.mode === 'pedestrian' || transit.mode === 'walking_fallback';

  return (
    <div style={{
      margin: '0.5rem 0 0.5rem 0.5rem',
      paddingLeft: '1.5rem',
      borderLeft: '2px dashed rgba(99, 102, 241, 0.4)',
      position: 'relative'
    }}>
      {/* Small dot on the dashed line */}
      <div style={{
        position: 'absolute',
        left: '-5px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: isWalking ? 'var(--secondary)' : 'var(--primary)',
        border: '2px solid var(--bg-main)'
      }}></div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '0.75rem',
        padding: '0.75rem 1rem',
        transition: 'var(--transition-smooth)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {/* Mode Icon */}
            {isWalking ? (
              // Walking Footprints SVG
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--secondary)' }}>
                <path d="M4 16v-2a2 2 0 1 1 4 0v2"></path>
                <path d="M12 14v-2a2 2 0 1 1 4 0v2"></path>
                <path d="M16 12V6a2 2 0 1 1 4 0v6"></path>
                <path d="M8 12V8a2 2 0 1 1 4 0v4"></path>
              </svg>
            ) : (
              // Transit Subway/Bus SVG
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary)' }}>
                <rect x="4" y="3" width="16" height="16" rx="2"></rect>
                <line x1="9" y1="21" x2="9" y2="19"></line>
                <line x1="15" y1="21" x2="15" y2="19"></line>
                <line x1="4" y1="9" x2="20" y2="9"></line>
                <circle cx="8" cy="14" r="1"></circle>
                <circle cx="16" cy="14" r="1"></circle>
              </svg>
            )}
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>
              {isWalking ? 'Walk' : `Take ${transit.line_name || 'Transit'}`}
            </span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
              ⏱️ {transit.duration_minutes} mins
            </span>
            {transit.distance_meters > 0 && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                ({(transit.distance_meters / 1000).toFixed(1)} km)
              </span>
            )}
          </div>
        </div>

        {/* Directions steps Accordion trigger */}
        {transit.step_by_step && transit.step_by_step.length > 0 && (
          <div style={{ marginTop: '0.2rem' }}>
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--secondary)',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '0',
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                outline: 'none'
              }}
            >
              <span>{expanded ? 'Hide Directions' : 'View Directions'}</span>
              <span style={{
                transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'var(--transition-smooth)',
                display: 'inline-block'
              }}>▾</span>
            </button>

            {expanded && (
              <ul style={{
                marginTop: '0.5rem',
                paddingLeft: '1.2rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.35rem',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                listStyleType: 'disc',
                animation: 'fadeIn 0.3s ease-out',
                textAlign: 'left'
              }}>
                {transit.step_by_step.map((step, sIdx) => (
                  <li key={sIdx}>{step}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


const INTERESTS_OPTIONS = [
  'Foodie',
  'History',
  'Nature',
  'Anime',
  'Shopping',
  'Adventure',
  'Art & Museums',
  'Relaxation',
  'Nightlife',
  'Wellness'
];

// Helper to format ISO 8601 duration (e.g. PT6H30M -> 6h 30m)
function formatDuration(durationStr: string): string {
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return durationStr;
  const hours = match[1] ? `${match[1]}h` : '';
  const mins = match[2] ? `${match[2]}m` : '';
  return `${hours} ${mins}`.trim() || 'Direct';
}

const CARRIER_NAMES: Record<string, string> = {
  "AI": "Air India",
  "6E": "IndiGo",
  "JL": "Japan Airlines",
  "LH": "Lufthansa",
  "EK": "Emirates",
  "BA": "British Airways",
  "AF": "Air France",
  "UA": "United Airlines",
  "DL": "Delta Air Lines",
  "AA": "American Airlines",
  "SQ": "Singapore Airlines",
  "QR": "Qatar Airways"
};

function getCarrierName(code: string, name?: string): string {
  if (name) return name;
  return CARRIER_NAMES[code] || `${code} Airways`;
}

function formatPrice(price: string, currency: string): string {
  const amount = parseFloat(price);
  if (isNaN(amount)) return price;
  if (currency === 'EUR') return `€${Math.round(amount)}`;
  if (currency === 'USD') return `$${Math.round(amount)}`;
  return `${currency} ${amount}`;
}

const IATA_MAPPING: Record<string, string> = {
  tokyo: "TYO",
  kyoto: "UKY",
  osaka: "OSA",
  goa: "GOI",
  mumbai: "BOM",
  delhi: "DEL",
  bangalore: "BLR",
  paris: "PAR",
  rome: "ROM",
  london: "LON",
  newyork: "NYC",
  sydney: "SYD",
  japan: "TYO",
  india: "DEL",
  france: "PAR",
  italy: "ROM",
  germany: "FRA",
  munich: "MUC",
  berlin: "BER"
};

function resolveIataCode(cityName: string): string {
  const norm = cityName.toLowerCase().replace(/[^a-z]/g, '');
  for (const [key, code] of Object.entries(IATA_MAPPING)) {
    if (norm.includes(key)) return code;
  }
  const codeMatch = cityName.match(/[A-Z]{3}/);
  if (codeMatch) return codeMatch[0];
  return "DEL"; // Default fallback
}

export default function App() {
  // Form state
  const [origin, setOrigin] = useState('Delhi, India');
  const [destination, setDestination] = useState('');
  const [duration, setDuration] = useState(4);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pace, setPace] = useState<'Relaxed' | 'Balanced' | 'Packed'>('Balanced');
  const [budget, setBudget] = useState<'Budget' | 'Mid-range' | 'Luxury'>('Mid-range');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  
  // App state
  const [loading, setLoading] = useState(false);
  const [logisticsLoading, setLogisticsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itinerary, setItinerary] = useState<DayPlan[] | null>(null);
  const [logistics, setLogistics] = useState<LogisticsPayload | null>(null);
  const [activeDay, setActiveDay] = useState(1);
  const [highlightedVenue, setHighlightedVenue] = useState<string | null>(null);
  
  // Dynamic edit state variables
  const [editRequest, setEditRequest] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editSuccessMessage, setEditSuccessMessage] = useState<string | null>(null);

  // Custom interest chip selection handler
  const handleToggleInterest = (interest: string) => {
    setSelectedInterests(prev => 
      prev.includes(interest) 
        ? prev.filter(i => i !== interest) 
        : [...prev, interest]
    );
  };

  // Duration increment / decrement helper
  const handleDurationChange = (amount: number) => {
    setDuration(prev => {
      const val = prev + amount;
      return Math.max(1, Math.min(14, val)); // Clamped between 1 and 14 days
    });
  };

  // Form submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination.trim()) {
      setError('Please provide a destination.');
      return;
    }
    if (!origin.trim()) {
      setError('Please provide an origin city.');
      return;
    }
    if (selectedInterests.length === 0) {
      setError('Please select at least one interest chip.');
      return;
    }

    setLoading(true);
    setLogisticsLoading(true);
    setError(null);
    setItinerary(null);
    setLogistics(null);

    // Format dates string if provided
    let datesString = '';
    if (startDate && endDate) {
      const start = new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const end = new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      datesString = `${start} - ${end}`;
    } else if (startDate) {
      datesString = new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    const itineraryPayload = {
      destination,
      duration,
      dates: datesString || undefined,
      pace,
      budget,
      interests: selectedInterests
    };

    const logisticsPayload = {
      origin,
      destination,
      startDate: startDate || undefined,
      endDate: endDate || undefined
    };

    const fetchItinerary = async () => {
      try {
        const response = await fetch('/api/itinerary', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(itineraryPayload)
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Something went wrong while generating itinerary.');
        }

        setItinerary(data);
        setActiveDay(1);
      } catch (err: any) {
        setError(err.message || 'Server connection failed.');
      } finally {
        setLoading(false);
      }
    };

    const fetchLogistics = async () => {
      try {
        const response = await fetch('/api/logistics', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(logisticsPayload)
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Something went wrong while fetching logistics.');
        }

        setLogistics(data);
      } catch (err: any) {
        console.error("Error fetching logistics data:", err);
      } finally {
        setLogisticsLoading(false);
      }
    };

    // Concurrently trigger both promises
    Promise.all([fetchItinerary(), fetchLogistics()]);
  };

  // Form edit handler for Dynamic Reroute loop
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editRequest.trim()) return;
    if (!itinerary) return;

    setEditLoading(true);
    setError(null);
    setEditSuccessMessage(null);

    try {
      const payload = {
        current_itinerary: itinerary,
        user_edit_request: editRequest,
        destination
      };

      const response = await fetch('/api/itinerary/edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reroute this day.');
      }

      setItinerary(data.itinerary);
      setEditSuccessMessage(data.message);
      setEditRequest('');

      // Auto dismiss success toast after 6 seconds
      setTimeout(() => {
        setEditSuccessMessage(null);
      }, 6000);

    } catch (err: any) {
      setError(err.message || 'Server edit connection failed.');
    } finally {
      setEditLoading(false);
    }
  };

  // Calculate total estimated itinerary cost helper
  const getTotalCost = () => {
    if (!itinerary) return 0;
    return itinerary.reduce((total, day) => {
      return total + day.activities.reduce((dayTotal, act) => {
        if ('type' in act && act.type === 'transit_segment') return dayTotal;
        const activity = act as ActivityItem;
        return dayTotal + (activity.estimated_cost_usd || 0);
      }, 0);
    }, 0);
  };

  // Get active day plan details helper
  const getActiveDayPlan = () => {
    if (!itinerary) return null;
    return itinerary.find(d => d.day === activeDay) || itinerary[0];
  };

  const activeDayPlan = getActiveDayPlan();

  return (
    <div className="app-container">
      {/* Page Title & Subtitle */}
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-icon">
            <Compass size={32} color="#FFF" />
          </div>
          <h1 className="app-title">Vagabond AI</h1>
        </div>
        <p className="app-subtitle">
          Generate structured, seasonal, and hyper-personalized travel itineraries in seconds using structured machine intelligence.
        </p>
      </header>

      <main className="main-grid">
        {/* Input Panel Form */}
        <section className="glass-panel">
          <h2 className="form-title">
            <Sparkles size={20} color="#6366F1" />
            Build Your Adventure
          </h2>

          <form onSubmit={handleSubmit}>
            {/* Origin City */}
            <div className="form-group">
              <label className="form-label">Origin City</label>
              <div className="input-wrapper">
                <Plane className="input-icon" size={18} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Delhi, India"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Destination */}
            <div className="form-group">
              <label className="form-label">Destination</label>
              <div className="input-wrapper">
                <MapPin className="input-icon" size={18} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Tokyo, Japan or Goa, India"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Duration */}
            <div className="form-group">
              <label className="form-label">Duration (Days)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                  type="button"
                  onClick={() => handleDurationChange(-1)}
                  style={{
                    padding: '0.5rem 1rem',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '0.5rem',
                    color: 'white',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    minWidth: '40px'
                  }}
                  disabled={duration <= 1}
                >
                  -
                </button>
                <span style={{ fontSize: '1.25rem', fontWeight: 700, minWidth: '30px', textAlign: 'center' }}>
                  {duration}
                </span>
                <button
                  type="button"
                  onClick={() => handleDurationChange(1)}
                  style={{
                    padding: '0.5rem 1rem',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '0.5rem',
                    color: 'white',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    minWidth: '40px'
                  }}
                  disabled={duration >= 14}
                >
                  +
                </button>
              </div>
            </div>

            {/* Travel Dates */}
            <div className="form-group">
              <label className="form-label">Dates (Optional for Seasonality)</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-wrapper">
                  <Calendar className="input-icon" size={16} />
                  <input
                    type="date"
                    className="form-input"
                    style={{ paddingLeft: '2.5rem' }}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="input-wrapper">
                  <Calendar className="input-icon" size={16} />
                  <input
                    type="date"
                    className="form-input"
                    style={{ paddingLeft: '2.5rem' }}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    min={startDate}
                  />
                </div>
              </div>
            </div>

            {/* Pace */}
            <div className="form-group">
              <label className="form-label">Pace</label>
              <div className="segmented-control">
                {(['Relaxed', 'Balanced', 'Packed'] as const).map((p) => (
                  <div
                    key={p}
                    className={`segment-option ${pace === p ? 'active' : ''}`}
                    onClick={() => setPace(p)}
                  >
                    <span>{p}</span>
                    <span style={{ fontSize: '0.65rem', opacity: 0.8, fontWeight: 400 }}>
                      {p === 'Relaxed' && '2-3 spots/day'}
                      {p === 'Balanced' && '3-4 spots/day'}
                      {p === 'Packed' && '5+ spots/day'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Budget Tier */}
            <div className="form-group">
              <label className="form-label">Budget Tier</label>
              <div className="segmented-control">
                {(['Budget', 'Mid-range', 'Luxury'] as const).map((b) => (
                  <div
                    key={b}
                    className={`segment-option ${budget === b ? 'active' : ''}`}
                    onClick={() => setBudget(b)}
                  >
                    <span>{b}</span>
                    <span style={{ fontSize: '0.65rem', opacity: 0.8, fontWeight: 400 }}>
                      {b === 'Budget' && '$'}
                      {b === 'Mid-range' && '$$'}
                      {b === 'Luxury' && '$$$'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Interests Chips */}
            <div className="form-group">
              <label className="form-label">Travel Interests</label>
              <div className="chips-grid">
                {INTERESTS_OPTIONS.map((interest) => {
                  const isSelected = selectedInterests.includes(interest);
                  return (
                    <div
                      key={interest}
                      className={`interest-chip ${isSelected ? 'active' : ''}`}
                      onClick={() => handleToggleInterest(interest)}
                    >
                      <div className="chip-dot"></div>
                      {interest}
                      {isSelected && <Check size={12} style={{ marginLeft: '0.2rem' }} />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Error Message display */}
            {error && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '0.75rem 1rem',
                borderRadius: '0.75rem',
                color: '#FCA5A5',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.9rem',
                marginBottom: '1rem'
              }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            <button 
              type="submit" 
              className="btn-submit"
              disabled={loading}
            >
              {loading ? (
                <>
                  <div style={{
                    width: '18px',
                    height: '18px',
                    border: '2px solid rgba(255,255,255,0.2)',
                    borderLeftColor: 'white',
                    borderRadius: '50%',
                    animation: 'spin 0.6s linear infinite'
                  }}></div>
                  Compiling Itinerary...
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  Compile Itinerary
                </>
              )}
            </button>
          </form>
        </section>

        {/* Display Output Section */}
        {!itinerary && (
          <section className="glass-panel" style={{ minHeight: '500px' }}>
            {loading && (
              <div className="loading-container">
                <div className="spinner"></div>
                <p className="loading-text">Assembling Travel Data Engine...</p>
                <p className="loading-subtext">Compiling localized activities, mapping out ideal time slots, and formatting structure</p>
              </div>
            )}

            {!loading && (
              <div className="itinerary-placeholder">
                <Compass size={64} className="placeholder-icon" />
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'white', marginBottom: '0.5rem' }}>No Itinerary Generated</h3>
                <p style={{ maxWidth: '350px', fontSize: '0.95rem' }}>
                  Fill out the form with your travel preferences and click "Compile Itinerary" to generate your structured plans.
                </p>
              </div>
            )}
          </section>
        )}

        {/* 3-Column Display Output Sections - Shown when itinerary exists */}
        {itinerary && (
          <>
            {/* Column 2: Timeline & Day Navigation */}
            <section className="glass-panel timeline-panel">
              <div className="itinerary-container">
                {/* Success Toast Notification */}
                {editSuccessMessage && (
                  <div className="edit-success-toast">
                    <Sparkles size={16} color="#34D399" />
                    <span>{editSuccessMessage}</span>
                  </div>
                )}

                {/* Header Info */}
                <div className="itinerary-header">
                  <div className="itinerary-info">
                    <h2>{destination} Itinerary</h2>
                    <div className="itinerary-meta-badges">
                      <span className="meta-badge">{duration} Days</span>
                      <span className="meta-badge">{pace} Pace</span>
                      <span className="meta-badge">{budget} Budget</span>
                      {selectedInterests.slice(0, 3).map(interest => (
                        <span key={interest} className="meta-badge" style={{ borderColor: 'var(--secondary)' }}>
                          {interest}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Estimated Local Budget
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#34D399', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                      <DollarSign size={18} />
                      {getTotalCost()} <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '0.2rem', fontWeight: 500 }}>USD</span>
                    </div>
                  </div>
                </div>

                {/* Day Navigation Tabs */}
                <div className="day-nav">
                  {itinerary.map((dayPlan) => (
                    <div
                      key={dayPlan.day}
                      className={`day-tab ${activeDay === dayPlan.day ? 'active' : ''}`}
                      onClick={() => setActiveDay(dayPlan.day)}
                    >
                      <div className="day-tab-num">Day {dayPlan.day}</div>
                      <div className="day-tab-label">timeline</div>
                    </div>
                  ))}
                </div>

                {/* Selected Day View */}
                {activeDayPlan && (
                  <div className="day-panel">
                    {/* Theme Info card */}
                    <div className="day-summary-card">
                      <h4 className="day-theme-title">Theme: {activeDayPlan.theme}</h4>
                      <p className="day-theme-desc">Structured day schedule mapped by local optimization metrics.</p>
                    </div>

                    {/* Activities Timeline list */}
                    <div className="timeline">
                      {activeDayPlan.activities.map((item, idx) => {
                        // Render Transit Segment Bridge
                        if ('type' in item && item.type === 'transit_segment') {
                          const transit = item as TransitSegmentItem;
                          return <TransitBridge key={idx} transit={transit} />;
                        }

                        // Render Attraction/Restaurant Activity Card
                        const activity = item as ActivityItem;
                        return (
                          <div 
                            key={idx} 
                            className="activity-card"
                            onMouseEnter={() => setHighlightedVenue(activity.location_name)}
                            onMouseLeave={() => setHighlightedVenue(null)}
                            style={{ cursor: 'pointer' }}
                          >
                            <div className="activity-time-badge">
                              <Clock size={14} />
                              <span>{activity.time_slot}</span>
                            </div>
                            <h3 className="activity-title">{activity.location_name}</h3>
                            <p className="activity-desc">{activity.description}</p>
                            
                            {/* Address & Coordinates added in Step 2 */}
                            {activity.verified_address && (
                              <div className="activity-address">
                                <MapPin size={12} style={{ marginTop: '0.15rem', flexShrink: 0 }} />
                                <span>{activity.verified_address}</span>
                              </div>
                            )}
                            {activity.coordinates && (
                              <div className="activity-coordinates-badge" style={{ marginBottom: '0.75rem' }}>
                                <span>Lat: {activity.coordinates.latitude.toFixed(6)}</span>
                                <span style={{ color: 'var(--text-muted)' }}>|</span>
                                <span>Lng: {activity.coordinates.longitude.toFixed(6)}</span>
                              </div>
                            )}

                            <div className="activity-meta">
                              <span className="activity-tag tag-type">
                                <Compass size={12} />
                                {activity.activity_type}
                              </span>
                              <span className="activity-tag tag-cost">
                                <DollarSign size={12} />
                                {activity.estimated_cost_usd === 0 ? 'Free' : `${activity.estimated_cost_usd} USD`}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Reroute This Day Edit Input */}
                    <div className="reroute-box">
                      <div className="reroute-header">
                        <Sparkles size={16} color="var(--primary)" />
                        <h4>Reroute Day {activeDay}</h4>
                      </div>
                      <form onSubmit={handleEditSubmit} className="reroute-form">
                        <textarea
                          className="reroute-input"
                          placeholder='e.g. "I don&apos;t want to go to the museum anymore. Replace it with an outdoor park."'
                          value={editRequest}
                          onChange={(e) => setEditRequest(e.target.value)}
                          disabled={editLoading}
                          required
                        />
                        <button
                          type="submit"
                          className="btn-reroute"
                          disabled={editLoading || !editRequest.trim()}
                        >
                          {editLoading ? (
                            <div className="reroute-spinner"></div>
                          ) : (
                            <Send size={16} />
                          )}
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Column 3: Logistics sidebar + Map Panel */}
            <div className="logistics-map-panel" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              {/* Leaflet Interactive Map View */}
              {activeDayPlan && (
                <MapComponent 
                  activities={activeDayPlan.activities} 
                  highlightedVenue={highlightedVenue}
                />
              )}

              {/* Logistics & Booking Overview Sidebar */}
              <div className="glass-panel logistics-sidebar">
                <h3 className="logistics-title">
                  <Plane size={22} color="var(--primary)" />
                  Logistics & Booking
                </h3>

                {logisticsLoading ? (
                  <div className="logistics-section">
                    <div className="skeleton-text-pulse" style={{ width: '40%', height: '14px' }}></div>
                    <div className="skeleton-card"></div>
                    <div className="skeleton-card"></div>
                    <div className="skeleton-text-pulse" style={{ width: '50%', height: '14px', marginTop: '1rem' }}></div>
                    <div className="skeleton-card"></div>
                  </div>
                ) : logistics ? (
                  <>
                    {/* Flights section */}
                    <div className="logistics-section">
                      <h4 className="logistics-section-title">
                        <Plane size={16} />
                        Suggested Flights
                      </h4>
                      {logistics.logistics.suggested_flights.length === 0 ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No suggested flights found.</p>
                      ) : (
                        logistics.logistics.suggested_flights.map((flight, idx) => (
                          <div key={idx} className="logistics-card">
                            <div className="logistics-card-left">
                              <div className="logistics-card-title">
                                {getCarrierName(flight.carrier, flight.carrier_name)}
                              </div>
                              <div className="logistics-card-subtitle">
                                <span>{resolveIataCode(origin)}</span>
                                <ArrowRight size={12} />
                                <span>{logistics.destination_city_code}</span>
                                <span style={{ color: 'var(--text-muted)' }}>•</span>
                                <span>{formatDuration(flight.duration)}</span>
                              </div>
                            </div>
                            <div className="logistics-price-badge">
                              {formatPrice(flight.total_price_eur, flight.currency)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Hotels section */}
                    <div className="logistics-section" style={{ marginTop: '0.5rem' }}>
                      <h4 className="logistics-section-title">
                        <Hotel size={16} />
                        Recommended Lodging
                      </h4>
                      {logistics.logistics.suggested_hotels.length === 0 ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No hotels found in this city.</p>
                      ) : (
                        logistics.logistics.suggested_hotels.map((hotel, idx) => (
                          <div key={idx} className="logistics-card">
                            <div className="logistics-card-left">
                              <div className="logistics-card-title">{hotel.hotel_name}</div>
                              <div className="logistics-card-subtitle">
                                <span className="logistics-hotel-badge">Chain: {hotel.chain_code}</span>
                                <span style={{ color: 'var(--text-muted)' }}>ID: {hotel.hotel_id}</span>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="logistics-footer">
                      Real-time inventory mapping provided by Amadeus Self-Service API
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Logistics metadata could not be retrieved. Check your API settings.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
