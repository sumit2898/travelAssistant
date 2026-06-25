import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Initialize Gemini Client
// The SDK automatically uses process.env.GEMINI_API_KEY or process.env.GOOGLE_API_KEY
// but we pass it explicitly if needed to avoid startup issues.
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GEMINI_API_KEY or GOOGLE_API_KEY is not defined in environment variables.");
}
const ai = new GoogleGenAI({ apiKey });

// Define the response schema using OpenAPI format required by Google Gen AI SDK
const responseSchema = {
  type: "ARRAY",
  description: "A list of daily plans representing the complete itinerary",
  items: {
    type: "OBJECT",
    properties: {
      day: {
        type: "INTEGER",
        description: "The number of the travel day, starting from 1"
      },
      theme: {
        type: "STRING",
        description: "The overarching theme or focus of this day"
      },
      activities: {
        type: "ARRAY",
        description: "The list of scheduled activities for this day",
        items: {
          type: "OBJECT",
          properties: {
            time_slot: {
              type: "STRING",
              description: "The time range of the activity (e.g. 09:00 AM - 11:30 AM)"
            },
            location_name: {
              type: "STRING",
              description: "The name of the location or business"
            },
            description: {
              type: "STRING",
              description: "A short, engaging description of what to do there, context, and why it is recommended"
            },
            activity_type: {
              type: "STRING",
              description: "The category of activity (e.g. Culture/History, Foodie, Shopping, Nature, Adventure, Entertainment)"
            },
            estimated_cost_usd: {
              type: "INTEGER",
              description: "Approximate cost in USD per person. Set to 0 if it is free"
            }
          },
          required: ["time_slot", "location_name", "description", "activity_type", "estimated_cost_usd"]
        }
      }
    },
    required: ["day", "theme", "activities"]
  }
};

// Popular destinations coordinates mapping for realistic mock geocoding fallbacks
const POPULAR_DESTINATIONS: Record<string, [number, number]> = {
  tokyo: [139.6917, 35.6895],
  kyoto: [135.7681, 35.0116],
  osaka: [135.5023, 34.6937],
  goa: [74.1240, 15.2993],
  mumbai: [72.8777, 19.0760],
  delhi: [77.1025, 28.7041],
  bangalore: [77.5946, 12.9716],
  paris: [2.3522, 48.8566],
  rome: [12.4964, 41.9028],
  london: [-0.1278, 51.5074],
  newyork: [-74.0060, 40.7128],
  sydney: [151.2093, -33.8688],
  italy: [12.5674, 41.8719],
  india: [78.9629, 20.5937]
};

// Geocoding & POI enrichment helper using Mapbox APIs with clean fallbacks
// Haversine formula to compute great-circle distance in meters between two lat/long points
function getHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

// Single POI geocoding helper using Mapbox search box API with clean simulated fallbacks
async function geocodeLocation(venueName: string, destinationCity: string): Promise<{
  coordinates: { latitude: number; longitude: number };
  verified_address: string;
  place_id: string;
}> {
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;
  const hasToken = mapboxToken && mapboxToken !== 'your_mapbox_access_token_here' && mapboxToken.trim() !== '';

  let cityCenter: [number, number] = [139.6917, 35.6895]; // Default to Tokyo
  const searchNormalized = destinationCity.toLowerCase().replace(/[^a-z]/g, '');
  
  for (const [key, coords] of Object.entries(POPULAR_DESTINATIONS)) {
    if (searchNormalized.includes(key)) {
      cityCenter = coords;
      break;
    }
  }

  if (hasToken) {
    try {
      const proximity = `${cityCenter[0]},${cityCenter[1]}`;
      const searchUrl = `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(venueName)}&proximity=${proximity}&limit=1&access_token=${mapboxToken}`;
      
      const searchRes = await fetch(searchUrl);
      if (searchRes.ok) {
        const searchData: any = await searchRes.json();
        if (searchData.features && searchData.features.length > 0) {
          const feature = searchData.features[0];
          const coordinates = feature.geometry.coordinates; // [lng, lat]
          const address = feature.properties.full_address || feature.properties.address || "Address unavailable";
          const mapboxId = feature.properties.mapbox_id || `mbx-${Math.random().toString(36).substring(2, 9)}`;

          return {
            coordinates: {
              latitude: coordinates[1],
              longitude: coordinates[0]
            },
            verified_address: address,
            place_id: mapboxId
          };
        }
      }
    } catch (err) {
      console.error(`Error geocoding location "${venueName}":`, err);
    }
  }

  // Fallback Dispersion offset around city center
  const latOffset = (Math.random() - 0.5) * 0.05;
  const lngOffset = (Math.random() - 0.5) * 0.05;
  return {
    coordinates: {
      latitude: cityCenter[1] + latOffset,
      longitude: cityCenter[0] + lngOffset
    },
    verified_address: `${venueName}, Central District, ${destinationCity}`,
    place_id: `fallback-place-${Math.random().toString(36).substring(2, 11)}`
  };
}

// Geocoding & POI enrichment helper using Mapbox APIs with clean fallbacks
async function enrichItineraryData(rawItinerary: any[], destinationCity: string): Promise<any[]> {
  for (const day of rawItinerary) {
    if (!day.activities || !Array.isArray(day.activities)) continue;

    for (const activity of day.activities) {
      const venueName = activity.location_name;
      const geoResult = await geocodeLocation(venueName, destinationCity);
      activity.coordinates = geoResult.coordinates;
      activity.verified_address = geoResult.verified_address;
      activity.place_id = geoResult.place_id;
    }
  }
  return rawItinerary;
}

// Single-segment public transit router calculation using HERE APIs with geodesic fallbacks
async function calculateTransitSegment(origin: any, destination: any): Promise<any> {
  const apiKey = process.env.HERE_API_KEY;
  const hasToken = apiKey && apiKey !== 'your_here_api_key_here' && apiKey.trim() !== '';

  const originCoords = origin.coordinates;
  const destCoords = destination.coordinates;

  if (!originCoords || !destCoords) {
    return {
      type: "transit_segment",
      mode: "walking_fallback",
      duration_minutes: 15,
      distance_meters: 1000,
      line_name: "Walk",
      step_by_step: ["Walk towards the next location."]
    };
  }

  if (hasToken) {
    try {
      const originParam = `${originCoords.latitude},${originCoords.longitude}`;
      const destParam = `${destCoords.latitude},${destCoords.longitude}`;
      const url = `https://transit.router.hereapi.com/v8/routes?origin=${originParam}&destination=${destParam}&return=travelSummary,polyline,actions&apiKey=${apiKey}`;

      const res = await fetch(url);
      if (res.ok) {
        const data: any = await res.json();
        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const section = route.sections[0];
          const summary = section.travelSummary || {};
          const actions = section.actions || [];
          const steps = actions.map((act: any) => act.instruction || "Proceed to next location");

          return {
            type: "transit_segment",
            mode: section.type || "transit",
            duration_minutes: Math.max(1, Math.round(summary.duration / 60)),
            distance_meters: summary.length || 0,
            line_name: section.transport?.name || (section.type === 'pedestrian' ? 'Walking' : 'Local Transit'),
            step_by_step: steps.length > 0 ? steps : ["Board local transport towards next location."]
          };
        }
      } else {
        const errText = await res.text();
        console.warn(`HERE Transit API failed (status ${res.status}): ${errText}`);
      }
    } catch (err) {
      console.error(`Error querying HERE Transit API:`, err);
    }
  }

  // Simulated fallback
  const distanceMeters = getHaversineDistance(
    originCoords.latitude,
    originCoords.longitude,
    destCoords.latitude,
    destCoords.longitude
  );

  if (distanceMeters < 1000) {
    const duration = Math.max(2, Math.round(distanceMeters / 83));
    return {
      type: "transit_segment",
      mode: "pedestrian",
      duration_minutes: duration,
      distance_meters: Math.round(distanceMeters),
      line_name: "Walking",
      step_by_step: [
        `Exit ${origin.location_name.split(' in ')[0]}.`,
        `Walk head east towards ${destination.location_name.split(' in ')[0]} (~${Math.round(distanceMeters)}m).`,
        `Arrive at ${destination.location_name.split(' in ')[0]}.`
      ]
    };
  } else {
    const duration = Math.max(10, Math.round((distanceMeters / 1000) * 4 + 5));
    const lineOptions = ["Metro Line A", "Express Shuttle", "Route 102 Bus", "Local Link Shuttle"];
    const selectedLine = lineOptions[Math.floor(Math.random() * lineOptions.length)];

    return {
      type: "transit_segment",
      mode: "transit",
      duration_minutes: duration,
      distance_meters: Math.round(distanceMeters),
      line_name: selectedLine,
      step_by_step: [
        `Walk to the nearest transit platform from ${origin.location_name.split(' in ')[0]}.`,
        `Board the ${selectedLine} heading towards ${destination.location_name.split(' in ')[0]}.`,
        `Ride transit for ~${(distanceMeters / 1000).toFixed(1)} km.`,
        `Arrive and exit station; walk 150m to ${destination.location_name.split(' in ')[0]}.`
      ]
    };
  }
}

// Sequence router to calculate multi-modal public transit routing between adjacent locations
async function injectTransitRoutes(enrichedItinerary: any[]): Promise<any[]> {
  for (const day of enrichedItinerary) {
    const activities = day.activities;
    if (!activities || activities.length < 2) continue;

    const transitSegments = [];

    for (let i = 0; i < activities.length - 1; i++) {
      const origin = activities[i];
      const destination = activities[i + 1];
      const segment = await calculateTransitSegment(origin, destination);
      transitSegments.push(segment);
    }

    // Interleave activities and transit segments
    const interleaved = [];
    for (let idx = 0; idx < activities.length; idx++) {
      interleaved.push(activities[idx]);
      if (idx < transitSegments.length) {
        interleaved.push(transitSegments[idx]);
      }
    }
    day.activities = interleaved;
  }

  return enrichedItinerary;
}

app.post('/api/itinerary', async (req: Request, res: Response) => {
  try {
    const { destination, duration, dates, pace, budget, interests } = req.body;

    // Simple validation
    if (!destination || !duration || !pace || !budget || !interests || !Array.isArray(interests)) {
      return res.status(400).json({ error: "Missing required fields or interests is not an array." });
    }

    const durationNum = parseInt(duration, 10);
    if (isNaN(durationNum) || durationNum <= 0) {
      return res.status(400).json({ error: "Duration must be a positive number." });
    }

    // Construct detailed prompt
    let userPrompt = `Create a detailed ${durationNum}-day travel itinerary for ${destination}.
Pace: ${pace} (e.g. Relaxed, Balanced, or Packed).
Budget Tier: ${budget}.
Interests: ${interests.join(', ')}.`;

    if (dates) {
      userPrompt += `\nTravel Dates / Seasonality Alignment: The trip takes place during: ${dates}. Make sure the activities are suitable for this time of year/season.`;
    }
    console.log(`Generating itinerary for ${destination} (${durationNum} days)...`);

    const hasGeminiKey = apiKey && apiKey !== 'your_gemini_api_key_here' && apiKey.trim() !== '';
    let rawItinerary: any[] = [];
    let usedMock = false;

    if (hasGeminiKey) {
      try {
        const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
        const response = await ai.models.generateContent({
          model: modelName,
          contents: userPrompt,
          config: {
            systemInstruction: "You are a professional travel data engine. Your task is to generate a day-by-day travel itinerary based on the user's constraints. You must respond ONLY with a valid JSON array matching the exact schema provided. Do not include any conversational text, introductions, or markdown formatting blocks like ```json outside of the data structure.",
            responseMimeType: "application/json",
            responseSchema: responseSchema as any,
            temperature: 0.3
          }
        });

        const responseText = response.text;
        if (!responseText) {
          throw new Error("Received empty response from Gemini API.");
        }
        rawItinerary = JSON.parse(responseText);
      } catch (apiError: any) {
        console.warn("Gemini API call failed, falling back to mock itinerary:", apiError.message || apiError);
        usedMock = true;
      }
    }

    if (!hasGeminiKey || usedMock) {
      console.warn("Generating simulated itinerary fallback...");
      
      // Generate standard mock itinerary structured data
      for (let d = 1; d <= durationNum; d++) {
        const theme = `Highlights of ${destination} - Focus on ${interests.slice(0, 2).join(' & ')}`;
        const activities = [];
        const baseInterests = interests.length > 0 ? interests : ['Sightseeing', 'Foodie'];
        
        // Define day slots
        const slots = ["09:00 AM - 11:30 AM", "12:00 PM - 02:00 PM", "03:30 PM - 06:00 PM"];
        const categories = ["Culture/History", "Foodie", "Shopping/Leisure"];
        
        for (let i = 0; i < Math.min(slots.length, baseInterests.length + 1); i++) {
          const interest = baseInterests[i % baseInterests.length];
          const slot = slots[i];
          
          let location = `Historic ${interest} Square`;
          let desc = `A popular local hub featuring top rated ${interest.toLowerCase()} locations, landmarks, and scenic strolls.`;
          let cost = 10 + i * 15;

          if (interest === 'Foodie') {
            location = `Traditional Culinary Tavern`;
            desc = `Renowned local spot specializing in authentic regional dishes and chef-curated tastings.`;
            cost = 35;
          } else if (interest === 'Anime') {
            location = `Pixel Plaza & Arcade`;
            desc = `A massive entertainment arcade and store specializing in rare collectibles, retro games, and anime figures.`;
            cost = 15;
          } else if (interest === 'Shopping') {
            location = `Bustling Local Market Street`;
            desc = `A historic shopping avenue lined with local vendors, hand-crafted souvenirs, and street food carts.`;
            cost = 0;
          } else if (interest === 'History') {
            location = `Ancient Heritage Sanctuary`;
            desc = `A beautifully preserved landmark showcasing traditional architecture, historical artifacts, and gardens.`;
            cost = 5;
          } else if (interest === 'Nature') {
            location = `Scenic Riverside Gardens`;
            desc = `A tranquil escape from the city hustle, offering lush walking paths, cherry blossom spots, and lake views.`;
            cost = 0;
          }

          activities.push({
            time_slot: slot,
            location_name: `${location} in ${destination}`,
            description: desc,
            activity_type: categories[i % categories.length],
            estimated_cost_usd: cost
          });
        }

        rawItinerary.push({
          day: d,
          theme: theme,
          activities: activities
        });
      }
    }
    // Enrich itinerary with geo-encoding spatial metadata
    console.log(`Enriching itinerary with geo-encoding details for "${destination}"...`);
    const enrichedItinerary = await enrichItineraryData(rawItinerary, destination);

    // Inject transit routing schedules between adjacent activities
    console.log(`Calculating public transit routes for "${destination}"...`);
    const finalizedItinerary = await injectTransitRoutes(enrichedItinerary);

    return res.json(finalizedItinerary);

  } catch (error: any) {
    console.error("Error generating itinerary:", error);
    return res.status(500).json({
      error: "Failed to generate itinerary. Please verify your environment settings and try again.",
      details: error.message
    });
  }
});

// Target edit instruction response schema for Gemini Structured Outputs
const modifiedSlotSchema = {
  type: "OBJECT",
  description: "Specifies a precise, localized activity slot modification instruction.",
  properties: {
    day: {
      type: "INTEGER",
      description: "The 1-indexed day number where the modified activity resides"
    },
    activity_index: {
      type: "INTEGER",
      description: "The exact array index of the activity object to modify inside the day's activities list. Make sure to identify the correct activity node (do NOT choose index of a transit segment object, which has type 'transit_segment')."
    },
    new_location_name: {
      type: "STRING",
      description: "The name of the new location, landmark, or venue"
    },
    new_description: {
      type: "STRING",
      description: "A short, engaging updated description of what to do there"
    },
    new_activity_type: {
      type: "STRING",
      description: "The category of the new activity (e.g. Culture/History, Foodie, Shopping, Nature, Adventure, Entertainment)"
    },
    estimated_cost_usd: {
      type: "INTEGER",
      description: "The estimated cost per person in USD"
    }
  },
  required: ["day", "activity_index", "new_location_name", "new_description", "new_activity_type", "estimated_cost_usd"]
};

app.post('/api/itinerary/edit', async (req: Request, res: Response) => {
  try {
    const { current_itinerary, user_edit_request, destination } = req.body;

    if (!current_itinerary || !user_edit_request || !destination) {
      return res.status(400).json({ error: "Missing required fields current_itinerary, user_edit_request, or destination." });
    }

    const hasGeminiKey = apiKey && apiKey !== 'your_gemini_api_key_here' && apiKey.trim() !== '';
    let editInstruction: any = null;
    let usedMock = false;

    if (hasGeminiKey) {
      try {
        const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
        const systemInstruction = 
          "You are a precise travel data patch editor. You will receive a complete travel itinerary in JSON format and a modification request from the user. " +
          "Analyze the current itinerary data and find the exact day and index of the activity slot that the user wants to change. " +
          "Return the modified details matching the provided response schema. " +
          "Make sure the activity_index is the correct index in the day's activities array (do NOT select a transit segment at that index. Transit segments have type 'transit_segment'). " +
          "Ensure the new_location_name is a specific landmark name in or near the destination. " +
          "Do not alter any other slots or days.";

        const prompt = `Current Itinerary Data:\n${JSON.stringify(current_itinerary, null, 2)}\n\nUser Change Request:\n"${user_edit_request}"`;

        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: modifiedSlotSchema as any,
            temperature: 0.1
          }
        });

        const responseText = response.text;
        if (!responseText) {
          throw new Error("Received empty response from Gemini API.");
        }
        editInstruction = JSON.parse(responseText);
      } catch (apiError: any) {
        console.warn("Gemini edit API call failed, falling back to mock edit:", apiError.message || apiError);
        usedMock = true;
      }
    }

    if (!hasGeminiKey || usedMock) {
      console.warn("Generating mock edit fallback...");
      
      let targetDay = 1;
      const dayMatch = user_edit_request.match(/day\s*(\d+)/i);
      if (dayMatch) {
        targetDay = parseInt(dayMatch[1], 10);
      }

      const dayPlan = current_itinerary.find((d: any) => d.day === targetDay) || current_itinerary[0];
      let targetActIndex = 0;
      if (dayPlan && dayPlan.activities) {
        for (let i = 0; i < dayPlan.activities.length; i++) {
          if (dayPlan.activities[i].type !== 'transit_segment') {
            targetActIndex = i;
            break;
          }
        }
      }

      editInstruction = {
        day: dayPlan ? dayPlan.day : 1,
        activity_index: targetActIndex,
        new_location_name: "Lush Botanic Gardens",
        new_description: "A gorgeous scenic park featuring curated tropical conservatories, peaceful walking paths, and beautiful lake views.",
        new_activity_type: "Nature",
        estimated_cost_usd: 5
      };
    }

    console.log("Gemini resolved edit instruction:", editInstruction);

    const updatedItinerary = JSON.parse(JSON.stringify(current_itinerary));
    const dayPlan = updatedItinerary.find((d: any) => d.day === editInstruction.day);
    if (!dayPlan) {
      return res.status(404).json({ error: `Day ${editInstruction.day} not found in the current itinerary.` });
    }

    const actIndex = editInstruction.activity_index;
    if (actIndex < 0 || actIndex >= dayPlan.activities.length) {
      return res.status(404).json({ error: `Activity index ${actIndex} out of bounds for Day ${editInstruction.day}.` });
    }

    const targetActivity = dayPlan.activities[actIndex];
    if (targetActivity.type === 'transit_segment') {
      return res.status(400).json({ error: `Target index ${actIndex} corresponds to a transit segment, not an activity.` });
    }

    const oldLocationName = targetActivity.location_name;

    // 1. Update activity properties
    targetActivity.location_name = editInstruction.new_location_name;
    targetActivity.description = editInstruction.new_description;
    targetActivity.activity_type = editInstruction.new_activity_type;
    targetActivity.estimated_cost_usd = editInstruction.estimated_cost_usd;

    // 2. Resolve Geocoding for the new location in-place
    console.log(`Re-geocoding node: "${editInstruction.new_location_name}"...`);
    const geoResult = await geocodeLocation(editInstruction.new_location_name, destination);
    targetActivity.coordinates = geoResult.coordinates;
    targetActivity.verified_address = geoResult.verified_address;
    targetActivity.place_id = geoResult.place_id;

    // 3. Repair transit segments before and after
    console.log("Repairing adjacent transit routes...");

    if (actIndex >= 2) {
      const prevActivity = dayPlan.activities[actIndex - 2];
      const updatedSegmentBefore = await calculateTransitSegment(prevActivity, targetActivity);
      dayPlan.activities[actIndex - 1] = updatedSegmentBefore;
      console.log(`Transit segment BEFORE repaired (index ${actIndex - 1})`);
    }

    if (actIndex <= dayPlan.activities.length - 3) {
      const nextActivity = dayPlan.activities[actIndex + 2];
      const updatedSegmentAfter = await calculateTransitSegment(targetActivity, nextActivity);
      dayPlan.activities[actIndex + 1] = updatedSegmentAfter;
      console.log(`Transit segment AFTER repaired (index ${actIndex + 1})`);
    }

    const message = `Replaced '${oldLocationName.split(' in ')[0]}' with '${editInstruction.new_location_name.split(' in ')[0]}' on Day ${editInstruction.day}. Transit connections repaired.`;

    return res.json({
      status: "success",
      action: "node_modified",
      affected_day: editInstruction.day,
      affected_index: editInstruction.activity_index,
      message,
      itinerary: updatedItinerary
    });

  } catch (error: any) {
    console.error("Error editing itinerary node:", error);
    return res.status(500).json({
      error: "Failed to reroute itinerary. Please check your instructions and try again.",
      details: error.message
    });
  }
});

// IATA mapping for major target destinations
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
  // Check if string contains a direct 3-letter uppercase airport code
  const codeMatch = cityName.match(/[A-Z]{3}/);
  if (codeMatch) return codeMatch[0];
  return "DEL"; // Default fallback
}

async function getAmadeusToken(): Promise<string | null> {
  const clientId = process.env.AMADEUS_CLIENT_ID;
  const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
  
  if (!clientId || !clientSecret || clientId === 'your_amadeus_client_id_here' || clientId.trim() === '') {
    return null;
  }

  try {
    const url = "https://test.api.amadeus.com/v1/security/oauth2/token";
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (res.ok) {
      const data: any = await res.json();
      return data.access_token;
    } else {
      const errText = await res.text();
      console.warn(`Amadeus token retrieval failed (status ${res.status}): ${errText}`);
      return null;
    }
  } catch (err) {
    console.error("Error connecting to Amadeus token endpoint:", err);
    return null;
  }
}

async function fetchTripLogistics(
  originIata: string, 
  destIata: string, 
  departureDate: string, 
  returnDate: string
): Promise<any> {
  const token = await getAmadeusToken();
  const logisticsPayload = {
    suggested_flights: [] as any[],
    suggested_hotels: [] as any[]
  };

  if (!token) {
    // Generate simulated high-fidelity logistics fallback for sandbox environment compatibility
    console.log(`Generating simulated travel logistics from ${originIata} to ${destIata}...`);
    
    // 1. Simulate flights
    const carriers = [
      { code: "AI", name: "Air India" },
      { code: "6E", name: "IndiGo" },
      { code: "JL", name: "Japan Airlines" },
      { code: "LH", name: "Lufthansa" },
      { code: "EK", name: "Emirates" }
    ];
    
    for (let i = 0; i < 3; i++) {
      const carrier = carriers[(i + destIata.charCodeAt(0)) % carriers.length];
      const basePrice = 250 + (destIata.charCodeAt(0) * 3) + (i * 85);
      const hours = 2 + (destIata.charCodeAt(1) % 10);
      const mins = 15 * (i % 4);

      logisticsPayload.suggested_flights.push({
        carrier: carrier.code,
        carrier_name: carrier.name,
        duration: `PT${hours}H${mins}M`,
        total_price_eur: basePrice.toFixed(2),
        currency: "EUR"
      });
    }

    // 2. Simulate hotels
    const hotelOptions = [
      { name: "Grand Palace Hotel", chain: "HY" },
      { name: "President Beach Resort", chain: "HH" },
      { name: "Royal Vista Plaza", chain: "SI" },
      { name: "Heritage Boutique Inn", chain: "MC" }
    ];

    for (let i = 0; i < 3; i++) {
      const hotel = hotelOptions[(i + destIata.charCodeAt(1)) % hotelOptions.length];
      logisticsPayload.suggested_hotels.push({
        hotel_name: `${destIata} ${hotel.name}`,
        hotel_id: `HT${destIata}${100 + i}`,
        chain_code: hotel.chain,
        coordinates: {
          latitude: 0,
          longitude: 0
        }
      });
    }

    return logisticsPayload;
  }

  const headers = { Authorization: `Bearer ${token}` };

  // 1. Live Flight offers search via Amadeus
  try {
    const flightUrl = `https://test.api.amadeus.com/v2/shopping/flight-offers?originLocationCode=${originIata}&destinationLocationCode=${destIata}&departureDate=${departureDate}&returnDate=${returnDate}&adults=1&max=3`;
    const res = await fetch(flightUrl, { headers });
    if (res.ok) {
      const data: any = await res.json();
      for (const offer of (data.data || [])) {
        if (!offer.itineraries || offer.itineraries.length === 0) continue;
        const itinerary = offer.itineraries[0];
        const segments = itinerary.segments || [];
        const carrier = segments.length > 0 ? segments[0].carrierCode : "AI";
        logisticsPayload.suggested_flights.push({
          carrier,
          duration: itinerary.duration || "PT6H0M",
          total_price_eur: offer.price.total,
          currency: offer.price.currency || "EUR"
        });
      }
    } else {
      const text = await res.text();
      console.warn(`Amadeus flight offers lookup failed: ${text}`);
    }
  } catch (err) {
    console.error("Error searching flight offers:", err);
  }

  // 2. Live Hotels list search by city via Amadeus
  try {
    const hotelUrl = `https://test.api.amadeus.com/v1/reference-data/locations/hotels/by-city?cityCode=${destIata}&radius=5&radiusUnit=KM`;
    const res = await fetch(hotelUrl, { headers });
    if (res.ok) {
      const data: any = await res.json();
      const hotels = data.data || [];
      for (const hotel of hotels.slice(0, 3)) {
        logisticsPayload.suggested_hotels.push({
          hotel_name: hotel.name,
          hotel_id: hotel.hotelId,
          chain_code: hotel.chainCode || "HT",
          coordinates: {
            latitude: hotel.geoCode?.latitude || 0,
            longitude: hotel.geoCode?.longitude || 0
          }
        });
      }
    } else {
      const text = await res.text();
      console.warn(`Amadeus hotels search failed: ${text}`);
    }
  } catch (err) {
    console.error("Error searching hotels list:", err);
  }

  return logisticsPayload;
}

app.post('/api/logistics', async (req: Request, res: Response) => {
  try {
    const { origin, destination, startDate, endDate } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: "Missing required fields origin or destination." });
    }

    // Default dates if not supplied (October 12 - October 16, 2026)
    const depDate = startDate || "2026-10-12";
    const retDate = endDate || "2026-10-16";

    // Resolve IATA codes
    const originIata = resolveIataCode(origin);
    const destIata = resolveIataCode(destination);

    console.log(`Logistics engine: resolving flights & hotels for ${origin} (${originIata}) -> ${destination} (${destIata})...`);

    const logistics = await fetchTripLogistics(originIata, destIata, depDate, retDate);

    return res.json({
      destination_city_code: destIata,
      logistics
    });

  } catch (err: any) {
    console.error("Error resolving logistics recommendation:", err);
    return res.status(500).json({
      error: "Failed to fetch flight and hotel logistics.",
      details: err.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: "healthy", apiKeyConfigured: !!apiKey });
});

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});
