//src/rides.js
import { prisma } from './prisma.js';
import { sendNotificationToUser } from './server.js';
import axios from 'axios'
import polylineUtil from '@mapbox/polyline';
import { Prisma } from '@prisma/client';
import { validationResult } from 'express-validator';

// Helper function to normalize strings for searching
const normalizeString = (str) => {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[\s\-_,.]+/g, ' ') // Replace multiple spaces/hyphens/etc with a single space
    .replace(/[أإآ]/g, 'ا')      // Normalize Alef
    .replace(/[ى]/g, 'ي')        // Normalize Yaa
    .replace(/[ؤ]/g, 'و')        // Normalize Waw
    .replace(/[ة]/g, 'ه')        // Normalize Taa Marbuta
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
export const createRide = async (req, res, next) => { // أضفنا "next" هنا
   console.log('--- BACKEND SERVER: RECEIVED BODY ---');
   console.log(req.body);
   
    // --- START: NEW VALIDATION CHECK ---
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // --- END: NEW VALIDATION CHECK ---

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
    
    // ** THE FIX: Normalize city and suburb names before saving **
    const fromCityNorm = normalizeString(fromCity);
    const fromSuburbNorm = normalizeString(fromSuburb);
    const toCityNorm = normalizeString(toCity);
    const toSuburbNorm = normalizeString(toSuburb);
    
    const newRide = await prisma.$transaction(async (tx) => {
      const ride = await tx.ride.create({
        data: {
          origin,
          destination,
          // ** THE FIX: Save the received city/suburb data **
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

      // This part for geospatial indexing remains the same
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
    let rideIds = new Set(); // Using a Set to automatically handle duplicates

    // --- Step 1: Geospatial Query (for high precision) ---
    if (startLat && startLng && endLat && endLng) {
      let timeFilterString = `AND "time" >= (NOW() AT TIME ZONE 'UTC')`;
      if (date) {
        const startDate = new Date(date);
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setUTCDate(startDate.getUTCDate() + 1);
        timeFilterString = `AND "time" >= '${startDate.toISOString()}' AND "time" < '${endDate.toISOString()}'`;
      }

      const searchRadiusInMeters = 1000; // 1km radius
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

    // --- Step 2: Text-based Query by Governorate (for broader results) ---
    if (fromGov && toGov) {
      const whereClause = {
        isRequest: isRequestBool,
        status: 'UPCOMING',
        fromCityNorm: normalizeString(fromGov),
        toCityNorm: normalizeString(toGov),
      };

      if (date) {
        const startDate = new Date(date);
        startDate.setUTCHours(0, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setUTCDate(startDate.getUTCDate() + 1);
        whereClause.time = { gte: startDate, lt: endDate };
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
            title: "New Interest in Your Ride!",
            message: `${interestedUser.name} is interested in your ride from ${ride.fromCity} to ${ride.toCity}.`,
            type: "NEW_INTEREST",
            userId: ride.driverId,
            relatedId: ride.id,
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
          title: "Ride Confirmed!",
          message: `The renter ride from ${ride.fromCity} to ${ride.toCity} is now confirmed and ready for booking.`,
          type: 'RIDE_CONFIRMED',
          userId: interest.userId,
          relatedId: ride.id,
        });
      }

      res.json({ message: 'Screenshot uploaded.', ride: updatedRide });
    } catch (error) {
      console.error('Renter screenshot upload error:', error);
      res.status(500).json({ error: 'Failed to upload screenshot.' });
    }
}

// --- [MODIFIED FUNCTION] ---
export const getLightweightMapRides = async ({ swLat, swLng, neLat, neLng, isRequest = false }) => {
  try {
    const rideWindowConfig = await prisma.appConfig.findUnique({
      where: { key: 'RIDE_DATE_WINDOW_DAYS' },
    });
    const rideWindowDays = rideWindowConfig ? parseInt(rideWindowConfig.value, 10) : 2;

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

    if (rides.length === 0) {
        return [];
    }
    
    const rideIds = rides.map(r => r.id);
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
              select: { seatsBooked: true },
            },
        }
    });

    const ridesWithComputedSeats = ridesWithRelations.map(ride => {
      const bookings = ride.bookings || [];
      const bookedAndPendingSeats = bookings.reduce((sum, booking) => sum + booking.seatsBooked, 0);
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