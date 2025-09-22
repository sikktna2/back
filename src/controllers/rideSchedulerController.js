import { prisma } from '../prisma.js';

// --- Saved Routes Functions ---

export const createSavedRoute = async (req, res, next) => {
  try {
    const { name, originAddress, originLat, originLng, destinationAddress, destinationLat, destinationLng } = req.body;
    const userId = req.user.userId;

    const savedRoute = await prisma.savedRoute.create({
      data: {
        name,
        originAddress,
        originLat,
        originLng,
        destinationAddress,
        destinationLat,
        destinationLng,
        userId,
      },
    });
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

export const updateScheduledRide = async (req, res, next) => {
    try {
        const { id } = req.params;
        const driverId = req.user.userId;
        const dataToUpdate = req.body;

        const updatedRide = await prisma.scheduledRide.updateMany({
            where: { id, driverId },
            data: dataToUpdate
        });

        if (updatedRide.count === 0) {
            return res.status(404).json({ message: 'Scheduled ride not found or you do not have permission to edit it.' });
        }
        
        const ride = await prisma.scheduledRide.findUnique({ where: { id }});
        res.status(200).json(ride);
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

export const processScheduledRides = async () => {
    const now = new Date();
    const currentDay = now.getUTCDay(); // 0 for Sunday, 1 for Monday...
    
    const activeSchedules = await prisma.scheduledRide.findMany({
        where: {
            isActive: true,
            daysOfWeek: { has: currentDay }
        },
        include: { driver: { include: { car: true } } }
    });

    for (const schedule of activeSchedules) {
        if (!schedule.driver.isVerified || !schedule.driver.car?.isVerified) {
            console.log(`Skipping scheduled ride for unverified driver or car: ${schedule.driver.name}`);
            continue;
        }

        const [hour, minute] = schedule.scheduleTime.split(':').map(Number);
        const rideDateTime = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));

        // Check if a ride for this schedule has already been created today
        const existingRide = await prisma.ride.findFirst({
            where: {
                driverId: schedule.driverId,
                origin: schedule.origin,
                destination: schedule.destination,
                time: rideDateTime
            }
        });

        if (!existingRide && rideDateTime > now) {
            await prisma.ride.create({
                data: {
                    origin: schedule.origin,
                    destination: schedule.destination,
                    fromCity: schedule.fromCity,
                    toCity: schedule.toCity,
                    fromCityNorm: schedule.fromCity.toLowerCase().trim(),
                    toCityNorm: schedule.toCity.toLowerCase().trim(),
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
                }
            });
            console.log(`Created a new ride from schedule ${schedule.id} for driver ${schedule.driver.name}`);
        }
    }
};