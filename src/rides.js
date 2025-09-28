//src/rides.js
import { prisma } from './prisma.js';
import { sendNotificationToUser } from './server.js';
import axios from 'axios'
import polylineUtil from '@mapbox/polyline';
import { Prisma } from '@prisma/client';
import { validationResult } from 'express-validator';

// Helper function to normalize strings for searching
// NEW, SMARTER NORMALIZE FUNCTION
const normalizeString = (str) => {
  if (!str) return '';
  return str
    .toLowerCase()
    // الخطوة 1: حذف الكلمات الإدارية غير المهمة
    .replace(/محافظة|governorate/g, '')
    // الخطوة 2: إزالة أي حرف غير أبجدي أو رقمي
    .replace(/[^a-z0-9\u0621-\u064A\s]/g, '')
    // الخطوة 3: توحيد الحروف العربية
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ؤ]/g, 'و')
    .replace(/[ة]/g, 'ه')
    // الخطوة 4: إزالة المسافات الزائدة
    .replace(/\s+/g, ' ')
    .trim();
};

const distKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};

// --- [MODIFIED FUNCTION] ---
// استبدل الدالة القديمة بهذه النسخة المحدثة بالكامل
export const createRide = async (req, res, next) => {
  console.log('--- [TEST 2] BACKEND: RECEIVED BODY ---');
  console.log(req.body);
   
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

  try {
    const {
      origin, destination, fromCity, fromSuburb, toCity, toSuburb,
      originLat, originLng, destinationLat, destinationLng, polyline,
      time, seats, price, isRequest = false, rideType = 'owner',
      serviceType, isAnonymous, additionalInfo, allowedGender, isTimeArranged
    } = req.body;
    
    const userId = req.user.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { car: true },
    });

    if (!user || !user.isVerified) {
      return res.status(403).json({ error: 'User must be verified to post a ride.' });
    }
    
    if (rideType === 'owner' && (!user.car || !user.car.isVerified)) {
        return res.status(403).json({ error: 'A verified car is required to post a ride as an owner.' });
    }
    
    const fromCityNorm = normalizeString(fromCity);
    const fromSuburbNorm = normalizeString(fromSuburb);
    const toCityNorm = normalizeString(toCity);
    const toSuburbNorm = normalizeString(toSuburb);
    
    const newRide = await prisma.$transaction(async (tx) => {
      const ride = await tx.ride.create({
        data: {
          origin,
          destination,
          fromCity: fromCity || '',
          fromSuburb: fromSuburb || '',
          toCity: toCity || '',
          toSuburb: toSuburb || '',
          fromCityNorm,
          fromSuburbNorm,
          toCityNorm,
          toSuburbNorm,
          originLat: parseFloat(originLat),
          originLng: parseFloat(originLng),
          destinationLat: parseFloat(destinationLat),
          destinationLng: parseFloat(destinationLng),
          polyline,
          time: new Date(time),
          seats: parseInt(seats),
          price: parseFloat(price),
          isTimeArranged: isTimeArranged || false,
          isRequest,
          rideType,
          serviceType,
          isAnonymous,
          additionalInfo,
          allowedGender,
          driverId: userId,
          carId: (rideType === 'owner' && user.car) ? user.car.id : null,
        },
      });

      console.log(`--- [TEST 2] RIDE CREATED IN DB WITH ID: ${ride.id}`);

      let lineString = '';
      if (polyline) {
        const decodedPoints = polylineUtil.decode(polyline);
        lineString = decodedPoints.map(p => `${p[1]} ${p[0]}`).join(',');
      }

      await tx.$executeRawUnsafe(`
        UPDATE "Ride"
        SET 
          "originGeom" = ST_SetSRID(ST_MakePoint(${parseFloat(originLng)}, ${parseFloat(originLat)}), 4326)::geography,
          "destinationGeom" = ST_SetSRID(ST_MakePoint(${parseFloat(destinationLng)}, ${parseFloat(destinationLat)}), 4326)::geography
          ${lineString ? `, "routeGeom" = ST_SetSRID(ST_MakeLine(ARRAY[${lineString.split(',').map(p => `ST_PointFromText('POINT(${p})')`)}]), 4326)::geography` : ''}
        WHERE id = '${ride.id}';
      `);
      
      console.log(`--- [TEST 2] GEOMETRY DATA UPDATED FOR RIDE ID: ${ride.id}`);
      return ride;
    });

    res.status(201).json(newRide);

  } catch (error) {
    console.error('Create ride error:', error);
    res.status(500).json({ error: 'Failed to create ride' });
  }
};

export const getUserRides = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { type } = req.query;

    const whereClause = {
      OR: [
        { driverId: userId },
        { bookings: { some: { userId: userId, status: { in: ['ACCEPTED', 'COMPLETED'] } } } },
      ],
    };

    if (type === 'upcoming') {
      whereClause.status = { in: ['UPCOMING', 'IN_PROGRESS'] };
    } else if (type === 'completed') {
      whereClause.status = 'COMPLETED';
    } else if (type === 'cancelled') {
      whereClause.status = 'CANCELLED';
    }

    const orderBy = (type === 'completed' || type === 'cancelled')
        ? { time: 'desc' }
        : { time: 'asc' };

    const rides = await prisma.ride.findMany({
      where: whereClause,
      include: {
        driver: {
          select: { id: true, name: true, profileImage: true, rating: true, isVerified: true },
        },
        bookings: {
          where: { status: { in: ['ACCEPTED', 'COMPLETED'] } },
          include: {
            user: { select: { id: true, name: true, profileImage: true } },
          },
        },
      },
      orderBy: orderBy,
    });
    
    res.json(rides);
  } catch (error) {
    console.error('Get user rides error:', error);
    res.status(500).json({ error: 'Failed to fetch user rides' });
  }
};


// --- [REVISED AND IMPROVED FUNCTION] ---
export const getAvailableRides = async (req, res, next) => {
  try {
    const {
      startLat, startLng, endLat, endLng,
      fromGov, toGov,
      date,
      sortBy = 'time',
      sortOrder = 'asc',
      isRequest = 'false',
    } = req.query;

    const isRequestBool = isRequest === 'true';
    let rideIds = new Set(); 

// --- الوسيلة الأولى: البحث الجغرافي بنطاق أوسع (5 كيلومتر) ---
if (startLat && startLng && endLat && endLng) {
  let timeFilterString;
if (date) {
  // --- START: TIMEZONE-AWARE DATE FIX ---
  const localDate = new Date(date);
  const startDate = new Date(Date.UTC(
    localDate.getFullYear(),
    localDate.getMonth(),
    localDate.getDate(),
    0, 0, 0, 0
  ));
  const endDate = new Date(startDate);
  endDate.setUTCDate(startDate.getUTCDate() + 1);
  timeFilterString = `AND "time" >= '${startDate.toISOString()}' AND "time" < '${endDate.toISOString()}'`;
  // --- END: TIMEZONE-AWARE DATE FIX ---
} else {
  timeFilterString = `AND "time" >= (NOW() AT TIME ZONE 'UTC')`;
}

  const searchRadiusInMeters = 1000; 
  const geoRides = await prisma.$queryRawUnsafe(`
        SELECT "id" FROM "Ride"
        WHERE "status" = 'UPCOMING' AND "isRequest" = ${isRequestBool} ${timeFilterString}
        AND ST_DWithin("originGeom", ST_SetSRID(ST_MakePoint(${startLng}, ${startLat}), 4326)::geography, ${searchRadiusInMeters})
        AND ST_DWithin("destinationGeom", ST_SetSRID(ST_MakePoint(${endLng}, ${endLat}), 4326)::geography, ${searchRadiusInMeters})
    `);

  if (geoRides && geoRides.length > 0) {
    geoRides.forEach(r => rideIds.add(r.id));
  }
}

// --- الوسيلة الثانية: البحث بالأسماء بشكل مرن (يحتوي على) ---
if (fromGov && toGov) {
  const whereClause = {
    isRequest: isRequestBool,
    status: 'UPCOMING',
    fromCityNorm: {
      contains: normalizeString(fromGov), // استخدام 'يحتوي على' بدلاً من المطابقة التامة
      mode: 'insensitive', 
    },
    toCityNorm: {
      contains: normalizeString(toGov), // استخدام 'يحتوي على' بدلاً من المطابقة التامة
      mode: 'insensitive',
    },
  };

  if (date) {
    // --- START: TIMEZONE-AWARE DATE FIX ---
// 1. Parse the incoming date string (e.g., "2025-09-29T00:00:00.000")
const localDate = new Date(date);

// 2. Create the start of the day in UTC based on the local date parts
const startDate = new Date(Date.UTC(
  localDate.getFullYear(),
  localDate.getMonth(),
  localDate.getDate(),
  0, 0, 0, 0
));

// 3. Create the end of the day by adding one full day
const endDate = new Date(startDate);
endDate.setUTCDate(startDate.getUTCDate() + 1);

// 4. Set the where clause to search within this correct UTC range
whereClause.time = { gte: startDate, lt: endDate };
// --- END: TIMEZONE-AWARE DATE FIX ---
  } else {
    whereClause.time = { gte: new Date() };
  }

  const textRides = await prisma.ride.findMany({
    where: whereClause,
    select: { id: true },
  });

  if (textRides && textRides.length > 0) {
    textRides.forEach(r => rideIds.add(r.id));
  }
}

    // --- Step 3: Fetch full data for the unique ride IDs ---
    const uniqueRideIds = Array.from(rideIds);
    if (uniqueRideIds.length === 0) {
      return res.json([]);
    }

    const ridesWithRelations = await prisma.ride.findMany({
      where: { id: { in: uniqueRideIds } },
      include: {
        driver: {
          select: {
            id: true, name: true, profileImage: true, rating: true,
            completedRides: true, isVerified: true, isPremium: true, gender: true,
            badges: { include: { badge: true } }
          }
        },
        bookings: { where: { status: { in: ['ACCEPTED', 'PENDING'] } } },
      },
      orderBy: { [sortBy]: sortOrder },
    });

    // --- Step 4. Process and return the final list ---
    const processedRides = ridesWithRelations.map(ride => {
      const bookedAndPendingSeats = ride.bookings.reduce((sum, b) => sum + b.seatsBooked, 0);
      const { bookings, ...rideWithoutBookings } = ride;
      return {
        ...rideWithoutBookings,
        computedAvailableSeats: ride.seats - bookedAndPendingSeats,
      };
    });

    res.json(processedRides.filter(r => r.computedAvailableSeats > 0));

  } catch (error) {
    next(error); // Pass error to the central handler
  }
};

export const registerInterest = async (req, res) => {
  try {
    const { id: rideId } = req.params;
    const userId = req.user.userId;

    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) return res.status(404).json({ error: 'Ride not found.' });
    if (ride.driverId === userId) return res.status(400).json({ error: 'You cannot show interest in your own ride.' });
    
    const existingInterest = await prisma.rideInterest.findUnique({
      where: {
        rideId_userId: { rideId, userId }
      }
    });

    if (existingInterest) {
      return res.status(409).json({ error: 'You have already shown interest in this ride.' });
    }

    await prisma.rideInterest.create({ 
      data: { rideId, userId } 
    });
    
    const interestedUser = await prisma.user.findUnique({ where: { id: userId } });
    if (interestedUser) {
        await sendNotificationToUser(ride.driverId, {
  type: "NEW_INTEREST",
  relatedId: ride.id,
  data: {
    userName: interestedUser.name,
    from: ride.fromCity,
    to: ride.toCity,
  },
});
    }

    res.status(201).json({ message: 'Interest registered successfully.'});
  } catch (error) {
    console.error('Register interest error:', error);
    res.status(500).json({ error: 'Failed to register interest.' });
  }
};

export const uploadRenterScreenshot = async (req, res) => {
    try {
      const { receiptPrice } = req.body;
      if (!req.file)
        return res.status(400).json({ error: 'No screenshot file uploaded.' });

      if (receiptPrice == null || isNaN(parseFloat(receiptPrice))) {
        return res.status(400).json({ error: 'A valid receipt price is required.' });
      }

      const ride = await prisma.ride.findFirst({
        where: { id: req.params.id, driverId: req.user.userId },
      });
      if (!ride)
        return res
          .status(404)
          .json({ error: 'Ride not found or you are not the driver.' });

      const updatedRide = await prisma.ride.update({
        where: { id: req.params.id },
        data: {
          renterScreenshotUrl: req.file.path,
          receiptPrice: parseFloat(receiptPrice), 
          status: 'UPCOMING',
        },
      });

      const interestedUsers = await prisma.rideInterest.findMany({
        where: { rideId: ride.id },
      });

      for (const interest of interestedUsers) {
        await sendNotificationToUser(interest.userId, {
  type: 'RIDE_CONFIRMED',
  relatedId: ride.id,
  data: {
    from: ride.fromCity,
    to: ride.toCity,
  },
}); 
      }

      res.json({ message: 'Screenshot uploaded.', ride: updatedRide });
    } catch (error) {
      console.error('Renter screenshot upload error:', error);
      res.status(500).json({ error: 'Failed to upload screenshot.' });
    }
}

// --- [MODIFIED FUNCTION] ---
export const getLightweightMapRides = async ({ swLat, swLng, neLat, neLng, isRequest = false, userId }) => {

  try {
    const user = await prisma.user.findUnique({
  where: { id: userId },
  select: { rideSearchWindowDays: true },
});
// استخدم تفضيل المستخدم، أو القيمة الافتراضية (2) إذا لم يكن موجودًا
const rideWindowDays = user?.rideSearchWindowDays ?? 7;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + rideWindowDays);

    const boundingBox = `POLYGON((${swLng} ${swLat}, ${neLng} ${swLat}, ${neLng} ${neLat}, ${swLng} ${neLat}, ${swLng} ${swLat}))`;
    
    // ** THE FIX: Convert the 'isRequest' string from the query into a boolean for Prisma **
    const isRequestBool = (isRequest === true || isRequest === 'true');

    const rides = await prisma.$queryRaw`
        SELECT 
            "id", "origin", "destination", "fromCity", "fromSuburb", "toCity", "toSuburb", 
            "originLat", "originLng", "destinationLat", "destinationLng", "polyline", 
            "time", "seats", "price", "rideType", "serviceType", "isAnonymous", 
            "driverId", "carId"
        FROM "Ride"
        WHERE
            "status" = 'UPCOMING' AND
            "isRequest" = ${isRequestBool} AND -- ** THE FIX: Use the boolean value here **
            "time" >= (NOW() AT TIME ZONE 'UTC') AND
            "time" <= ${endDate} AND 
            (
                ST_Intersects("originGeom", ST_GeomFromText(${boundingBox}, 4326)) OR
                ST_Intersects("destinationGeom", ST_GeomFromText(${boundingBox}, 4326)) OR
                ST_Intersects("routeGeom", ST_GeomFromText(${boundingBox}, 4326))
            )
    `;

    console.log(`--- [TEST 3] MAP QUERY FOUND ${rides.length} RIDES.`);

    if (rides.length === 0) {
        return [];
    }
    
    const rideIds = rides.map(r => r.id);
    // NEW, CORRECTED CODE BLOCK
const ridesWithRelations = await prisma.ride.findMany({
    where: { id: { in: rideIds } },
    select: {
        id: true, origin: true, destination: true, originLat: true, originLng: true,
        destinationLat: true, destinationLng: true, polyline: true, time: true,
        seats: true, price: true, fromCity: true, fromSuburb: true, toCity: true,
        toSuburb: true, rideType: true, serviceType: true, isAnonymous: true,
        driver: {
          select: {
            id: true, name: true, profileImage: true, rating: true, completedRides: true,
            isVerified: true, isPremium: true, gender: true,
          }
        },
        car: {
          select: {
            id: true, brand: true, model: true, year: true, color: true, plate: true, isVerified: true,
          }
        },
        bookings: {
          where: { status: { in: ['PENDING', 'ACCEPTED'] } },
          select: { id: true }, // We only need to count them, so fetching 'id' is enough
        },
    }
});

const ridesWithComputedSeats = ridesWithRelations.map(ride => {
  // The new calculation is much simpler: just count the number of booking records.
  const bookedAndPendingSeats = ride.bookings.length;
  const computedAvailableSeats = ride.seats - bookedAndPendingSeats;
  const { bookings: _, ...rideWithoutBookings } = ride;
  return {
    ...rideWithoutBookings,
    computedAvailableSeats: computedAvailableSeats,
  };
});

return ridesWithComputedSeats.filter(ride => ride.computedAvailableSeats > 0);

  } catch (error) {
    console.error('Get lightweight map rides DB error:', error);
    throw new Error('Failed to fetch lightweight map rides from database.');
  }
};

export const updateRidePrice = async (req, res) => {
  try {
    const { id: rideId } = req.params;
    const { newPrice } = req.body;
    const userId = req.user.userId;

    if (newPrice == null || isNaN(newPrice) || newPrice < 0) {
      return res.status(400).json({ error: 'A valid new price is required.' });
    }

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { bookings: { where: { status: 'ACCEPTED' } } },
    });

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found.' });
    }

    if (ride.driverId !== userId) {
      return res.status(403).json({ error: 'You are not the driver of this ride.' });
    }

    if (ride.bookings.length > 0) {
      return res.status(403).json({ error: 'Cannot change price after a booking is accepted.' });
    }

    const updatedRide = await prisma.ride.update({
      where: { id: rideId },
      data: { price: parseFloat(newPrice) },
    });

    res.json(updatedRide);
  } catch (error) {
    console.error('Update ride price error:', error);
    res.status(500).json({ error: 'Failed to update ride price.' });
  }
};