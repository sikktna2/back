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

/**
 * Finds and notifies users about potential partial matches for a newly created ride or request.
 * Runs in the background after a ride/request is created.
 * @param {object} newRide - The full ride object that was just created.
 */
async function findAndNotifyMatches(newRide) {
  // Do not run matching for renter rides or if polyline is missing
  if (newRide.rideType === 'renter' || !newRide.polyline) {
    return;
  }

  // Determine what we are searching for
  const searchForRequests = !newRide.isRequest; // If it's a ride, search for requests
  const searchRadiusInMeters = 3000; // 3km radius, can be adjusted

  const startPoint = `ST_SetSRID(ST_MakePoint(${newRide.originLng}, ${newRide.originLat}), 4326)::geography`;
  const endPoint = `ST_SetSRID(ST_MakePoint(${newRide.destinationLng}, ${newRide.destinationLat}), 4326)::geography`;

  try {
    // This powerful geospatial query finds items (rides or requests) that are contained within the new ride's path
    const query = `
      SELECT id, "driverId"
      FROM "Ride"
      WHERE
        "id" != '${newRide.id}' AND          -- Exclude the ride itself
        "status" = 'UPCOMING' AND           -- Must be an active item
        "isRequest" = ${searchForRequests} AND -- Search for the opposite type
        "routeGeom" IS NOT NULL AND
        -- Check if the item's start point is near the new ride's route
        ST_DWithin("originGeom", ${startPoint}, ${searchRadiusInMeters}) AND
        -- Check if the item's end point is near the new ride's route
        ST_DWithin("destinationGeom", ${endPoint}, ${searchRadiusInMeters}) AND
        -- Ensure the start point comes before the end point along the new ride's path
        ST_LineLocatePoint("routeGeom", ST_ClosestPoint("originGeom", "routeGeom")) < ST_LineLocatePoint("routeGeom", ST_ClosestPoint("destinationGeom", "routeGeom"));
    `;

    const matches = await prisma.$queryRawUnsafe(query);

    if (matches.length > 0) {
      console.log(`[Matching Service] Found ${matches.length} potential matches for ride ${newRide.id}.`);

      const newRideCreator = await prisma.user.findUnique({ where: { id: newRide.driverId } });

      for (const match of matches) {
        const matchedItemCreator = await prisma.user.findUnique({ where: { id: match.driverId } });
        
        if (newRide.isRequest) {
          // The new item is a REQUEST, so we found a matching RIDE
          const ride = await prisma.ride.findUnique({ where: { id: match.id } });
          // Notify the passenger (who created the request)
          await sendNotificationToUser(newRide.driverId, {
            type: 'SUGGESTED_RIDE',
            relatedId: ride.id, // Link to the suggested ride
            data: { driverName: matchedItemCreator.name, from: ride.fromCity, to: ride.toCity },
          });
          // Notify the driver (who owns the ride)
          await sendNotificationToUser(ride.driverId, {
            type: 'SUGGESTED_REQUEST',
            relatedId: newRide.id, // Link to the new request
            data: { passengerName: newRideCreator.name, from: newRide.fromCity, to: newRide.toCity },
          });
        } else {
          // The new item is a RIDE, so we found a matching REQUEST
          const request = await prisma.ride.findUnique({ where: { id: match.id } });
          // Notify the driver (who created the ride)
          await sendNotificationToUser(newRide.driverId, {
            type: 'SUGGESTED_REQUEST',
            relatedId: request.id, // Link to the suggested request
            data: { passengerName: matchedItemCreator.name, from: request.fromCity, to: request.toCity },
          });
          // Notify the passenger (who owns the request)
          await sendNotificationToUser(request.driverId, {
            type: 'SUGGESTED_RIDE',
            relatedId: newRide.id, // Link to the new ride
            data: { driverName: newRideCreator.name, from: newRide.fromCity, to: newRide.toCity },
          });
        }
      }
    }
  } catch (error) {
    console.error(`[Matching Service] Error finding matches for ride ${newRide.id}:`, error);
  }
}

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

    // **** START: MODIFICATION ****
    // Trigger the background matching service without waiting for it to finish
    findAndNotifyMatches(newRide).catch(e => console.error("Background matching failed:", e));
    // **** END: MODIFICATION ****

    // Trigger background matching job (this can be a separate function)
    (async () => {
        if (newRide.isRequest) {
            // Find rides that match this request
            // For each match, send 'SUGGESTED_RIDE' notification
        } else {
            // Find requests that match this ride
            // For each match, send 'SUGGESTED_REQUEST' notification
        }
    })().catch(e => console.error("Background matching failed:", e));

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
      // Now fetches both completed and cancelled rides for the "completed" tab
      whereClause.status = { in: ['COMPLETED', 'CANCELLED'] };
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
    const { startLat, startLng, endLat, endLng, fromGov, toGov, date, sortBy = 'time', sortOrder = 'asc', isRequest = 'false' } = req.query;

    const isRequestBool = isRequest === 'true';
    let finalRideIds = new Set();
    const searchRadiusInMeters = 2000; // 2km radius for pickup/dropoff

    // --- Phase 1: Direct and Partial Geospatial Search ---
    if (startLat && startLng && endLat && endLng) {
      const passengerStartPoint = `ST_SetSRID(ST_MakePoint(${startLng}, ${startLat}), 4326)::geography`;
      const passengerEndPoint = `ST_SetSRID(ST_MakePoint(${endLng}, ${endLat}), 4326)::geography`;

      let timeFilterString = `AND "time" >= (NOW() AT TIME ZONE 'UTC')`;
      if (date) {
        const localDate = new Date(date);
        const startDate = new Date(Date.UTC(localDate.getFullYear(), localDate.getMonth(), localDate.getDate()));
        const endDate = new Date(startDate);
        endDate.setUTCDate(startDate.getUTCDate() + 1);
        timeFilterString = `AND "time" >= '${startDate.toISOString()}' AND "time" < '${endDate.toISOString()}'`;
      }
      
      const partialMatchQuery = `
        SELECT id
        FROM "Ride"
        WHERE
          "status" = 'UPCOMING' AND "isRequest" = ${isRequestBool} ${timeFilterString}
          AND "routeGeom" IS NOT NULL
          AND ST_DWithin("routeGeom", ${passengerStartPoint}, ${searchRadiusInMeters})
          AND ST_DWithin("routeGeom", ${passengerEndPoint}, ${searchRadiusInMeters})
          AND ST_LineLocatePoint("routeGeom", ST_ClosestPoint("routeGeom", ${passengerStartPoint})) < ST_LineLocatePoint("routeGeom", ST_ClosestPoint("routeGeom", ${passengerEndPoint}))
      `;
      
      const matchedRides = await prisma.$queryRawUnsafe(partialMatchQuery);
      matchedRides.forEach(r => finalRideIds.add(r.id));
    }
    
    // --- Step 2: Fetch full data for the unique ride IDs ---
    const uniqueRideIds = Array.from(finalRideIds);
    if (uniqueRideIds.length === 0) {
      return res.json([]);
    }

    const ridesWithRelations = await prisma.ride.findMany({
      where: { id: { in: uniqueRideIds } },
      include: {
        driver: { select: { id: true, name: true, profileImage: true, rating: true, completedRides: true, isVerified: true } },
        bookings: { where: { status: { in: ['ACCEPTED', 'PENDING'] } } },
      },
      orderBy: { [sortBy]: sortOrder },
    });
    
    // --- Step 3. Process rides for partial pricing and return ---
    const processedRides = ridesWithRelations.map(ride => {
      const isDirectMatch = distKm(ride.originLat, ride.originLng, parseFloat(startLat), parseFloat(startLng)) < 2 && distKm(ride.destinationLat, ride.destinationLng, parseFloat(endLat), parseFloat(endLng)) < 2;
      let finalPrice = ride.price;

      if (!isDirectMatch) {
        const rideTotalDistance = ride.routeDistanceKm; // Assuming you add this field
        const passengerDistance = distKm(parseFloat(startLat), parseFloat(startLng), parseFloat(endLat), parseFloat(endLng));
        if (rideTotalDistance > 0) {
            const calculatedPrice = ride.price * (passengerDistance / rideTotalDistance);
            finalPrice = Math.ceil(calculatedPrice / 5) * 5; // Round up to nearest 5
        }
      }
      
      const { bookings, ...rideWithoutBookings } = ride;
      return {
        ...rideWithoutBookings,
        computedAvailableSeats: ride.seats - bookings.length,
        isPartialMatch: !isDirectMatch,
        partialPrice: finalPrice,
      };
    });

    res.json(processedRides.filter(r => r.computedAvailableSeats > 0));
  } catch (error) {
    next(error);
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
    const rideWindowDays = user?.rideSearchWindowDays ?? 7;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + rideWindowDays);
    const boundingBox = `POLYGON((${swLng} ${swLat}, ${neLng} ${swLat}, ${neLng} ${neLat}, ${swLng} ${neLat}, ${swLng} ${swLat}))`;
    
    const isRequestBool = (isRequest === true || isRequest === 'true');


    const rides = await prisma.$queryRaw`
        SELECT 
            "id", "origin", "destination", "fromCity", "fromSuburb", "toCity", "toSuburb", 
            "originLat", "originLng", "destinationLat", "destinationLng", "polyline", 
            "time", "seats", "price", "rideType", "serviceType", "isAnonymous", 
            "driverId", "carId", "status"::text
        FROM "Ride"
        WHERE
            "status" IN ('UPCOMING', 'IN_PROGRESS') AND
            "isRequest" = ${isRequestBool} AND
            -- This line is the crucial fix. It tells PostgreSQL to calculate the time itself.
            "time" >= (NOW() AT TIME ZONE 'UTC' - INTERVAL '3 hours') AND
            "time" <= ${endDate} AND 
            (
                ST_Intersects("originGeom", ST_GeomFromText(${boundingBox}, 4326)) OR
                ST_Intersects("destinationGeom", ST_GeomFromText(${boundingBox}, 4326)) OR
                ST_Intersects("routeGeom", ST_GeomFromText(${boundingBox}, 4326))
            )
    `;
    // --- END: NEW LOGIC ---
    console.log(`[BACKEND TEST] Database returned ${rides.length} rides.`);

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
          toSuburb: true, rideType: true, serviceType: true, isAnonymous: true, status: true,
          driver: {
            select: {
              id: true, name: true, profileImage: true, rating: true, completedRides: true,
              isVerified: true, isPremium: true, gender: true,
              currentLat: true, // جلب موقع السائق الحي
              currentLng: true
            }
          },
          car: {
            select: {
              id: true, brand: true, model: true, year: true, color: true, plate: true, isVerified: true,
            }
          },
          bookings: {
            where: { status: { in: ['PENDING', 'ACCEPTED', 'GROUP_PENDING'] } },
            select: { id: true },
          },
      }
    });

    const ridesWithComputedSeats = ridesWithRelations.map(ride => {
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

// استبدل الدالة القديمة بالكامل
// أضف هذه الدالة الجديدة بالكامل في نهاية الملف
export const offerToPickup = async (req, res, next) => {
  try {
    const { rideRequestId } = req.params;
    const { driverRideId } = req.body; // <-- استقبال ID رحلة السائق
    const offeringDriverId = req.user.userId;

    if (!driverRideId) {
      return res.status(400).json({ error: 'Driver ride ID is required.' });
    }

    // جلب كل البيانات المطلوبة في استعلام واحد لتحسين الأداء
    const [rideRequest, offeringDriver, driverRide] = await Promise.all([
      prisma.ride.findUnique({ where: { id: rideRequestId } }),
      prisma.user.findUnique({ where: { id: offeringDriverId } }),
      prisma.ride.findUnique({ where: { id: driverRideId } }),
    ]);
    
    // التحقق من صلاحية البيانات
    if (!rideRequest || !rideRequest.isRequest) {
      return res.status(404).json({ error: 'Ride request not found.' });
    }
    
    if (!driverRide || driverRide.driverId !== offeringDriverId) {
        return res.status(403).json({ error: 'The selected ride is not valid or does not belong to you.' });
    }

    const passengerId = rideRequest.driverId; // في الطلبات، الراكب هو "سائق" الطلب

    // إرسال إشعار للراكب صاحب الطلب مع تفاصيل العرض
    await sendNotificationToUser(passengerId, {
      type: 'RIDE_OFFER', // نوع إشعار جديد
      relatedId: driverRide.id, // ربط الإشعار برحلة السائق المعروضة
      data: {
        driverName: offeringDriver.name,
        from: driverRide.fromCity,
        to: driverRide.toCity,
      },
    });

    res.status(200).json({ message: 'Offer sent successfully.' });
  } catch (error) {
    next(error); // تمرير أي خطأ للمعالج المركزي
  }
};