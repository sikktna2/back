import { prisma } from '../prisma.js';
import axios from 'axios';
import polylineUtil from '@mapbox/polyline';

// --- Saved Routes Functions ---

export const createSavedRoute = async (req, res, next) => {
  try {
    // --- START: MODIFIED CODE ---
    // 1. استخراج كل الحقول الجديدة من الطلب
    const { 
      name, 
      icon, // Handle icon as well
      polyline,
      originAddress, 
      originLat, 
      originLng, 
      originCity, 
      originSuburb,
      destinationAddress, 
      destinationLat, 
      destinationLng,
      destinationCity,
      destinationSuburb
    } = req.body;
    const userId = req.user.userId;

    // 2. تمرير كل الحقول الجديدة إلى قاعدة البيانات
    const savedRoute = await prisma.savedRoute.create({
      data: {
        name,
        icon,
        polyline,
        originAddress,
        originLat,
        originLng,
        originCity,
        originSuburb,
        destinationAddress,
        destinationLat,
        destinationLng,
        destinationCity,
        destinationSuburb,
        userId,
      },
    });
    // --- END: MODIFIED CODE ---
    res.status(201).json(savedRoute);
  } catch (error) {
    next(error);
  }
};

export const getSavedRoutes = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const routes = await prisma.savedRoute.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    res.status(200).json(routes);
  } catch (error) {
    next(error);
  }
};

export const deleteSavedRoute = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    await prisma.savedRoute.deleteMany({
      where: {
        id,
        userId, // Ensures users can only delete their own routes
      },
    });
    res.status(200).json({ message: 'Saved route deleted successfully.' });
  } catch (error) {
    next(error);
  }
};


// --- Scheduled Rides Functions ---

export const createScheduledRide = async (req, res, next) => {
    try {
        const driverId = req.user.userId;

        // --- START: NEW PREMIUM CHECK ---
        const driver = await prisma.user.findUnique({ where: { id: driverId } });
        if (!driver || !driver.isPremium) {
            return res.status(403).json({ error: 'This feature is available for premium users only.' });
        }
        // --- END: NEW PREMIUM CHECK ---

        const {
            origin, destination, fromCity, toCity, originLat, originLng, destinationLat, destinationLng,
            seats, price, scheduleTime, daysOfWeek
        } = req.body;

        const scheduledRide = await prisma.scheduledRide.create({
            data: {
                driverId,
                origin, destination, fromCity, toCity, originLat, originLng, destinationLat, destinationLng,
                seats, price, scheduleTime, daysOfWeek,
            }
        });

        res.status(201).json(scheduledRide);
    } catch (error) {
        next(error);
    }
};

export const getScheduledRides = async (req, res, next) => {
    try {
        const driverId = req.user.userId;
        const rides = await prisma.scheduledRide.findMany({
            where: { driverId },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json(rides);
    } catch (error) {
        next(error);
    }
};

// NEW FUNCTION WITH CANCELLATION LOGIC
export const updateScheduledRide = async (req, res, next) => {
    try {
        const { id } = req.params;
        const driverId = req.user.userId;
        const { isActive } = req.body; // We only allow toggling active status

        const updatedSchedule = await prisma.scheduledRide.update({
            where: { id, driverId },
            data: { isActive },
        });

        // إذا تم إيقاف الجدول الزمني، قم بإلغاء كل الرحلات القادمة المرتبطة به
        if (isActive === false) {
            await prisma.ride.updateMany({
                where: {
                    scheduledRideId: id,
                    status: 'UPCOMING',
                },
                data: {
                    status: 'CANCELLED',
                },
            });
        }
        
        res.status(200).json(updatedSchedule);
    } catch (error) {
        next(error);
    }
};

export const deleteScheduledRide = async (req, res, next) => {
    try {
        const { id } = req.params;
        const driverId = req.user.userId;
        await prisma.scheduledRide.deleteMany({
            where: { id, driverId }
        });
        res.status(200).json({ message: 'Scheduled ride deleted successfully.' });
    } catch (error) {
        next(error);
    }
};


// --- Cron Job Function ---

// NEW ROLLING WINDOW LOGIC
export const processScheduledRides = async () => {
  console.log('Running scheduled rides processor...');
  
  const activeSchedules = await prisma.scheduledRide.findMany({
      where: { isActive: true },
      include: {
          driver: { include: { car: true } },
          createdRides: {
              where: { status: 'UPCOMING' },
              orderBy: { time: 'desc' },
          },
      },
  });

  for (const schedule of activeSchedules) {
    // توقف عن إنشاء رحلات إذا انتهى اشتراك البريميوم للمستخدم
   if (!schedule.driver.isPremium || !schedule.driver.isVerified || !schedule.driver.car || !schedule.driver.car.isVerified) {
        console.log(`Skipping schedule for non-premium/unverified driver: ${schedule.driver.name}`);
        continue;
    }

    const desiredUpcomingCount = schedule.daysOfWeek.length;
    const currentUpcomingCount = schedule.createdRides.length;
    const ridesToCreateCount = desiredUpcomingCount - currentUpcomingCount;

    if (ridesToCreateCount <= 0) {
        continue; // هذا الجدول لديه بالفعل ما يكفي من الرحلات المستقبلية
    }

    console.log(`Schedule ${schedule.id} needs ${ridesToCreateCount} new ride(s).`);

    // NEW, CORRECTED LINE
let lastRideDate = schedule.createdRides.length > 0
    ? new Date(schedule.createdRides[0].time)
    : new Date(new Date().setDate(new Date().getDate() - 1)); // ابدأ من الأمس

    const newRideDates = [];
    
    // ابحث عن الأيام التالية الصالحة لإنشاء رحلات
    while (newRideDates.length < ridesToCreateCount) {
        lastRideDate.setDate(lastRideDate.getDate() + 1); // انتقل لليوم التالي
        const dayOfWeek = lastRideDate.getUTCDay();

        if (schedule.daysOfWeek.includes(dayOfWeek)) {
            const [hour, minute] = schedule.scheduleTime.split(':').map(Number);
            const rideDateTime = new Date(Date.UTC(lastRideDate.getUTCFullYear(), lastRideDate.getUTCMonth(), lastRideDate.getUTCDate(), hour, minute));
            
            // تأكد من أن الوقت الجديد في المستقبل
            if (rideDateTime > new Date()) {
                 newRideDates.push(rideDateTime);
            }
        }
    }

    // قم بإنشاء الرحلات الجديدة
    for (const rideDate of newRideDates) {
        try {
            await createRideFromSchedule(schedule, rideDate);
            console.log(`Successfully created a ride for schedule ${schedule.id} on ${rideDate.toISOString()}`);
        } catch (error) {
            console.error(`Failed to create ride for schedule ${schedule.id}:`, error.message);
        }
    }
  }
};


// دالة مساعدة جديدة لإنشاء الرحلة وتحديث بياناتها الجغرافية
const createRideFromSchedule = async (schedule, rideDateTime) => {
    return prisma.$transaction(async (tx) => {
        let polyline = '';
        try {
            const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${schedule.originLng},${schedule.originLat};${schedule.destinationLng},${schedule.destinationLat}?overview=full&geometries=polyline`;
            const response = await axios.get(osrmUrl);
            if (response.data.routes && response.data.routes.length > 0) {
                polyline = response.data.routes[0].geometry;
            }
        } catch (error) {
            console.error(`Could not fetch polyline for scheduled ride ${schedule.id}:`, error.message);
        }

        const newRide = await tx.ride.create({
            data: {
                origin: schedule.origin,
                destination: schedule.destination,
                fromCity: schedule.fromCity,
                toCity: schedule.toCity,
                fromSuburb: schedule.fromSuburb || '',
                toSuburb: schedule.toSuburb || '',
                originLat: schedule.originLat,
                originLng: schedule.originLng,
                destinationLat: schedule.destinationLat,
                destinationLng: schedule.destinationLng,
                time: rideDateTime,
                seats: schedule.seats,
                price: schedule.price,
                rideType: 'owner',
                driverId: schedule.driverId,
                carId: schedule.driver.car.id,
                polyline: polyline,
                scheduledRideId: schedule.id, // <-- الربط بالجدول الزمني
            }
        });

        let lineString = '';
        if (polyline) {
            const decodedPoints = polylineUtil.decode(polyline);
            lineString = decodedPoints.map(p => `${p[1]} ${p[0]}`).join(',');
        }

        await tx.$executeRawUnsafe(`
            UPDATE "Ride" SET 
              "originGeom" = ST_SetSRID(ST_MakePoint(${schedule.originLng}, ${schedule.originLat}), 4326)::geography,
              "destinationGeom" = ST_SetSRID(ST_MakePoint(${schedule.destinationLng}, ${schedule.destinationLat}), 4326)::geography
              ${lineString ? `, "routeGeom" = ST_SetSRID(ST_MakeLine(ARRAY[${lineString.split(',').map(p => `ST_PointFromText('POINT(${p})')`)}]), 4326)::geography` : ''}
            WHERE id = '${newRide.id}';
        `);
    });
};