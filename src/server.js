//src/server.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import morgan from 'morgan';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import redisClient from './redisClient.js';
import friendsRoutes from './routes/friendsRoutes.js';
import http from 'http';
import jwt from 'jsonwebtoken';
import adminRoutes from './routes/adminRoutes.js';
import cron from 'node-cron';
import ngeohash from 'ngeohash';
import { body, validationResult } from 'express-validator';
import { upload } from './cloudinary.js';
import { prisma, connectDB, disconnectDB } from './prisma.js';
import { getRideComments, addRideComment } from './comments.js';
import { app, server, io } from './io.js';
import { processScheduledRides } from './controllers/rideSchedulerController.js';
import helmet from 'helmet';
// --- [تمت الإضافة] --- استيراد دوال التحكم الجديدة
import {
  getSavedRoutes,
  createSavedRoute,
  deleteSavedRoute,
  getScheduledRides,
  createScheduledRide,
  updateScheduledRide,
  deleteScheduledRide,
} from './controllers/rideSchedulerController.js';
import {
  updateStatsOnRideCompletion,
  updateStatsOnBookingResponse,
  updateStatsOnCancellation,
} from './badgeService.js';
import {
  createRide,
  getUserRides,
  getAvailableRides,
  registerInterest,
  getLightweightMapRides,
  updateRidePrice,
  offerToPickup,
} from './rides.js';
import {
  register,
  login,
  authenticate,
  requireAdmin,
  changePassword,
  logout,
  updateUserPreferences,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  googleSignIn,
  facebookSignIn,
} from './auth.js';
import {
  getProfile,
  getPublicProfile,
  updateProfile,
  updateCar,
  getCar,
  getStats,
  subscribePremium,
  cancelAutoRenew,
  getUserFeedbacks,
  resetFreeRideTimer,
} from './profile.js';
import fs from 'fs';
import path from 'path';
import { sendFriendRequest, respondToFriendRequest, getFriends } from './friends.js';

dotenv.config();

const translationsPath = path.join(process.cwd(), 'translations.json');
const translations = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));

const PORT = process.env.PORT || 3000;
// --- START: MODIFICATION (Socket.io Setup) ---
export const userSockets = new Map();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-here';
// --- END: MODIFICATION (Socket.io Setup) ---

const cacheMiddleware = (duration) => {
  return (req, res, next) => {
    const key = '__express__' + req.originalUrl || req.url;
    const cachedBody = mcache.get(key);
    if (cachedBody) {
      res.send(cachedBody);
      return;
    } else {
      res.sendResponse = res.send;
      res.send = (body) => {
        mcache.put(key, body, duration * 1000);
        res.sendResponse(body);
      };
      next();
    }
  };
};

// Middlewares
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));
app.use(bodyParser.json());

// Limiter for sensitive authentication actions
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login/register/reset requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication attempts from this IP, please try again after 15 minutes',
});

// A more general limiter for other API requests
const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again after 15 minutes',
});

// Connect to database
connectDB();

// Graceful shutdown
process.on('SIGINT', async () => {
  await disconnectDB();
  process.exit(0);
});


/**
 * Creates a notification in the DB and attempts to send it via Socket.IO.
 * @param {string} userId - The ID of the user who should receive the notification.
 * @param {object} notificationData - The data for the notification object.
 */
// --- START: MODIFICATION (Socket.io Helper and Connection Logic) ---
export const sendNotificationToUser = async (userId, notificationPayload) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferredLanguage: true } });
    const lang = user?.preferredLanguage || 'en';
    const t = translations[lang] || translations['en'];

    let title = t.notification_titles[notificationPayload.type] || 'Notification';
    let message = t.notification_messages[notificationPayload.type] || 'You have a new update.';

    if (notificationPayload.data) {
      for (const key in notificationPayload.data) {
        const regex = new RegExp(`{${key}}`, 'g');
        title = title.replace(regex, notificationPayload.data[key]);
        message = message.replace(regex, notificationPayload.data[key]);
      }
    }

    const notification = await prisma.notification.create({
      data: {
        userId: userId,
        type: notificationPayload.type,
        title: title,
        message: message,
        relatedId: notificationPayload.relatedId,
        bookingStatus: notificationPayload.bookingStatus,
      },
    });

    // **** START: MODIFICATION ****
    // Prepare the payload to be sent via socket, including extra data
    const socketPayload = {
      ...notification,
      rideId: notificationPayload.rideId, // Attach rideId if it exists
    };
    // **** END: MODIFICATION ****

    const userSocketIds = userSockets.get(userId);
    if (userSocketIds && userSocketIds.size > 0) {
      for (const socketId of userSocketIds) {
        io.to(socketId).emit('new_notification', socketPayload); // Send the modified payload
      }
    } else {
      console.log(`[Socket] User ${userId} has no active socket connection.`);
    }

    // Step 4: After saving, calculate the new unread counts for the recipient.
    const unreadMessages = await prisma.notification.count({
        where: { userId: userId, isRead: false, type: 'NEW_MESSAGE' }
    });
    const unreadNotifications = await prisma.notification.count({
        where: { userId: userId, isRead: false, type: { not: 'NEW_MESSAGE' } }
    });

    // Step 5: Emit the new counts to all of the recipient's connected sockets.
    if (userSocketIds && userSocketIds.size > 0) {
      console.log(`[Socket] Emitting 'unread_counts_updated' to user ${userId}.`);
      for (const socketId of userSocketIds) {
          io.to(socketId).emit('unread_counts_updated', {
              unreadNotifications,
              unreadMessages,
          });
      }
    }

  } catch (error) {
    console.error(`[Socket] Failed to create or send notification for user ${userId}:`, error);
  }
};

const notifyAdmins = async (eventName, data = {}) => {
    try {
        const adminUsers = await prisma.user.findMany({
            where: { role: 'ADMIN' },
            select: { id: true }
        });
        const adminIds = adminUsers.map(admin => admin.id);

        for (const adminId of adminIds) {
            const adminSocketIds = userSockets.get(adminId); // userSockets is now a Set
            if (adminSocketIds && adminSocketIds.size > 0) {
                for (const socketId of adminSocketIds) {
                     io.to(socketId).emit(eventName, data);
                }
                console.log(`Notified admin ${adminId} with event: ${eventName}`);
            }
        }
    } catch (error) {
        console.error('Failed to notify admins:', error);
    }
};

io.on('connection', (socket) => {
  console.log(`[Socket] A new client connected: ${socket.id}`);

  // Event listener for when a client sends their authentication token
  socket.on('authenticate', (token) => {
    if (!token) {
      console.log(`[Socket] Client ${socket.id} sent an empty token.`);
      return;
    }
    try {
      // Verify the token to get the userId
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.userId) {
        const userId = decoded.userId;

        // If this is the user's first socket connection, create a new Set for them.
        if (!userSockets.has(userId)) {
          userSockets.set(userId, new Set());
        }

        // Add the new socket ID to the user's set of connections.
        userSockets.get(userId).add(socket.id);
        console.log(`[Socket] Client ${socket.id} authenticated successfully as user ${userId}. Total sockets for this user: ${userSockets.get(userId).size}`);
      }
    } catch (error) {
      console.log(`[Socket] Authentication failed for client ${socket.id}:`, error.message);
    }
  });

  socket.on('join_ride_room', (rideId) => {
    socket.join(rideId);
    console.log(`[Socket] Client ${socket.id} joined room: ${rideId}`);
  });

  socket.on('leave_ride_room', (rideId) => {
    socket.leave(rideId);
    console.log(`[Socket] Client ${socket.id} left room: ${rideId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
    // We need to find which user this socket belonged to and remove it.
    for (const [userId, socketIds] of userSockets.entries()) {
      if (socketIds.has(socket.id)) {
        socketIds.delete(socket.id);
        console.log(`[Socket] Removed socket ${socket.id} for user ${userId}. Sockets remaining: ${socketIds.size}`);

        // If the user has no more active connections, remove them from the map.
        if (socketIds.size === 0) {
          userSockets.delete(userId);
          console.log(`[Socket] User ${userId} is now fully disconnected.`);
        }
        break; // Exit the loop once found
      }
    }
  });

  socket.on('update-location', (data) => {
  const { rideId, lat, lng } = data;
  if (!rideId || lat == null || lng == null) return;

  // Find the user ID associated with this socket connection
  const userId = Array.from(userSockets.entries()).find(
    ([id, sockets]) => sockets.has(socket.id)
  )?.[0];

  if (userId) {
    // Broadcast the location to everyone else in the same ride room
    // The 'socket.to(rideId)' sends it to everyone in the room except the sender
    socket.to(rideId).emit('location-update', {
      userId: userId,
      lat: lat,
      lng: lng,
    });
  }
});
});
// --- END: MODIFICATION (Socket.io Helper and Connection Logic) ---

// -------- Routes --------

// Health check
app.get('/health', (req, res) =>
  res.json({ ok: true, timestamp: new Date().toISOString() })
);

// Apply general rate limiting to all subsequent routes
app.use(generalApiLimiter);

// -------- Auth --------
app.post('/auth/register', authLimiter, [
    body('name').isString().trim().isLength({ min: 2 }),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('phone').isMobilePhone('ar-EG'),
    body('gender').isIn(['male', 'female']),
], register);
app.post('/auth/login', authLimiter, login);
app.post('/auth/logout', authenticate, logout);
app.post('/auth/forgot-password', authLimiter, forgotPassword);
app.post('/auth/reset-password', authLimiter, [
    body('token').isString().isLength({ min: 6, max: 6 }),
    body('password').isLength({ min: 6 }),
], resetPassword);
app.post('/auth/verify-email', authLimiter, verifyEmail);
app.post('/auth/resend-verification', authLimiter, resendVerification);
app.post('/auth/change-password', authenticate, [
    body('currentPassword').isString().notEmpty(),
    body('newPassword').isLength({ min: 6 }),
], changePassword);

app.post('/auth/google', googleSignIn); // <-- مسار جوجل الجديد
app.post('/auth/facebook', facebookSignIn); // <-- مسار فيسبوك الجديد

// -------- Profile & Users --------
app.get('/profile', authenticate, getProfile);
app.put('/profile', authenticate, [
    body('name').optional().isString().trim().isLength({ min: 2 }),
    body('birthDate').optional().isISO8601().toDate(),
    body('city').optional().isString().trim(),
    body('genderPreference').optional().isIn(['all', 'male', 'female']),
    body('darkMode').optional().isBoolean(),
], updateProfile);
app.get('/profile/car', authenticate, getCar);
app.put('/profile/car', authenticate, updateCar);
app.get('/profile/stats', authenticate, getStats);
app.put('/profile/reset-free-ride', authenticate, resetFreeRideTimer);
app.get('/users/:id', authenticate, getPublicProfile);
app.get('/users/:userId/friends', authenticate, getFriends);
app.get('/users/:id/feedbacks', authenticate, getUserFeedbacks);
app.get('/users/me/unread-counts', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const unreadNotifications = await prisma.notification.count({
      where: {
        userId: userId,
        isRead: false,
        type: { not: 'NEW_MESSAGE' }, // Exclude chat messages from this count
      },
    });
    // The unread message count is now primarily handled by the client
    // This endpoint can provide a fallback or initial count.
    const unreadMessages = await prisma.notification.count({
        where: {
            userId: userId,
            isRead: false,
            type: 'NEW_MESSAGE'
        }
    });
    res.json({
      unreadNotifications,
      unreadMessages,
    });
  } catch (error) {
    console.error('Get unread counts error:', error);
    res.status(500).json({ error: 'Failed to fetch unread counts' });
  }
});

app.get('/friends', authenticate, getFriends);
app.post('/friends/request', authenticate, sendFriendRequest);
app.put('/friends/request/:friendshipId/respond', authenticate, respondToFriendRequest);
app.use('/friends', friendsRoutes);

// --- [تمت الإضافة] --- المسارات الجديدة للمسارات المحفوظة والرحلات المجدولة
app.get('/profile/saved-routes', authenticate, getSavedRoutes);
app.post('/profile/saved-routes', authenticate, createSavedRoute);
app.delete('/profile/saved-routes/:id', authenticate, deleteSavedRoute);

app.get('/profile/scheduled-rides', authenticate, getScheduledRides);
app.post('/profile/scheduled-rides', authenticate, createScheduledRide);
app.put('/profile/scheduled-rides/:id', authenticate, updateScheduledRide);
app.delete('/profile/scheduled-rides/:id', authenticate, deleteScheduledRide);

// User preferences endpoints
app.put('/user/preferences', authenticate, updateUserPreferences);
app.get('/user/preferences', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        hasSeenOnboarding: true,
        preferredLanguage: true,
        darkMode: true,
      },
    });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'Failed to get user preferences' });
  }
});

// Endpoint for uploading a user's profile image
app.put(
  '/profile/image',
  authenticate,
  upload.single('image'),
  async (req, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.userId }});

      if (user && user.profileImageLocked) {
          return res.status(403).json({ error: 'Profile image cannot be changed.'});
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded.' });
      }
      const imageUrl = req.file.path;
      const updatedUser = await prisma.user.update({
        where: { id: req.user.userId },
        data: { 
            profileImage: imageUrl,
            profileImageLocked: true // Lock the image after the first successful upload
        },
        select: { id: true, profileImage: true },
      });
      res.json({
        message: 'Profile image updated successfully.',
        user: updatedUser,
      });
    } catch (error) {
      console.error('Profile image upload error:', error);
      res.status(500).json({ error: 'Failed to update profile image.' });
    }
  }
);

// Endpoint for uploading a car's license photo
app.put(
  '/profile/car/license',
  authenticate,
  upload.single('license'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No license file uploaded.' });
      }
      const licenseUrl = req.file.path;
      const updatedCar = await prisma.car.update({
        where: { userId: req.user.userId },
        data: {
          licensePhoto: licenseUrl,
          isVerified: false,
          verificationStatus: 'PENDING',
        },
      });
      res.json({
        message: 'Car license updated. Awaiting re-verification.',
        car: updatedCar,
      });
    } catch (error) {
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'No car found for this user. Please add car details first.',
        });
      }
      console.error('Car license upload error:', error);
      res.status(500).json({ error: 'Failed to update car license.' });
    }
  }
);

// Endpoint for driver to update their live location
app.post('/users/me/location', authenticate, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat == null || lng == null) {
      return res
        .status(400)
        .json({ error: 'Latitude and Longitude are required.' });
    }
    await prisma.user.update({
      where: { id: req.user.userId },
      data: {
        currentLat: parseFloat(lat),
        currentLng: parseFloat(lng),
      },
    });
    res.status(200).json({ message: 'Location updated' });
  } catch (error) {
    console.error('Location update error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// Fair Price Calculation
app.post('/calculate-fair-price', authenticate, async (req, res) => {
  try {
    const { distance, duration } = req.body;
    if (
      distance == null ||
      duration == null ||
      isNaN(distance) ||
      isNaN(duration)
    ) {
      return res.status(400).json({
        error: 'Valid distance (km) and duration (minutes) are required.',
      });
    }

     const FUEL_PRICE_PER_LITER = 13.0; // Average price for 92-octane fuel in EGP
    const AVG_KM_PER_LITER = 10.0;     // Average fuel consumption for a typical car
    const DEPRECIATION_PER_KM = 1.5;   // Estimated cost for tires, oil, maintenance, etc. per km in EGP
    const DEFAULT_SEATS_TO_SHARE = 3;  // Assume the driver is sharing the cost with 3 passengers

    const distanceInKm = parseFloat(distance);

    // 1. Calculate the total cost for the driver
    const fuelCost = (distanceInKm / AVG_KM_PER_LITER) * FUEL_PRICE_PER_LITER;
    const depreciationCost = distanceInKm * DEPRECIATION_PER_KM;
    const totalTripCost = fuelCost + depreciationCost;

    // 2. Calculate the price per seat by sharing the total cost
    const pricePerSeat = totalTripCost / DEFAULT_SEATS_TO_SHARE;

    // 3. Round the final price to the nearest 5 EGP for convenience
    const fairPrice = Math.round(pricePerSeat / 5) * 5;

    res.json({ fairPrice: Math.max(fairPrice, 10) }); // Ensure a minimum price of 10 EGP
  } catch (error) {
    console.error('Fair price calculation error:', error);
    res.status(500).json({ error: 'Failed to calculate fair price' });
  }
});

// Identity & Car Verification
app.post(
  '/verify-identity',
  authenticate,
  upload.fields([
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
    { name: 'drivingLicense', maxCount: 1 },
    { name: 'carLicense', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const userId = req.user.userId;
      const { files } = req;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { car: true },
      });

      if (!user) return res.status(404).json({ error: 'User not found.' });

      const hasIdFiles = files && files['idFront'] && files['idBack'];
      const hasLicenseFiles =
        files && files['drivingLicense'] && files['carLicense'];

      if (hasLicenseFiles && user.idVerificationStatus === 'NOT_SUBMITTED') {
        return res
          .status(400)
          .json({ error: 'You must upload and submit your ID before verifying a car.' });
      }
      if (hasLicenseFiles && !user.car) {
        return res
          .status(400)
          .json({ error: 'You must add car details before uploading a car license.' });
      }

      const userDataToUpdate = {};
      if (hasIdFiles) {
        userDataToUpdate.idFrontImageUrl = files['idFront'][0].path;
        userDataToUpdate.idBackImageUrl = files['idBack'][0].path;
        userDataToUpdate.idVerificationStatus = 'PENDING';
      }
      if (files && files['drivingLicense']) {
        userDataToUpdate.drivingLicenseUrl = files['drivingLicense'][0].path;
      }

      if (Object.keys(userDataToUpdate).length > 0) {
        await prisma.user.update({ where: { id: userId }, data: userDataToUpdate });
      }

      if (hasLicenseFiles) {
        await prisma.car.update({
          where: { userId },
          data: {
            licensePhoto: files['carLicense'][0].path,
            verificationStatus: 'PENDING',
          },
        });
      }

      res.json({ message: 'Documents uploaded successfully. Awaiting review.' });
      await notifyAdmins('new_verification_request');
    } catch (error) {
      console.error('Verification upload error:', error);
      res
        .status(500)
        .json({ error: 'Failed to upload verification documents' });
    }
  }
);

app.get('/osrm-proxy/route', authenticate, async (req, res) => {
  try {
    const { startLon, startLat, endLon, endLat } = req.query;

    if (!startLon || !startLat || !endLon || !endLat) {
      return res
        .status(400)
        .json({ error: 'Start and end coordinates are required.' });
    }

    const osrmUrl = `http://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?alternatives=true&overview=full&geometries=polyline`;

    const response = await axios.get(osrmUrl);

    res.json(response.data);
  } catch (error) {
    console.error('OSRM proxy error:', error.message);
    res.status(500).json({ error: 'Failed to fetch route from OSRM' });
  }
});

// -------- Rides --------
// --- [THIS IS THE MODIFIED ENDPOINT] ---
app.get('/rides/map/lightweight', authenticate, async (req, res) => {
  try {
    const { swLat, swLng, neLat, neLng, isRequest } = req.query; // <-- Read isRequest
    if (!swLat || !swLng || !neLat || !neLng) {
      return res.status(400).json({ error: 'Map boundaries are required.' });
    }

    const rideWindowConfig = await prisma.appConfig.findUnique({
      where: { key: 'RIDE_DATE_WINDOW_DAYS' },
    });
    const rideWindowDays = rideWindowConfig ? parseInt(rideWindowConfig.value, 10) : 2;

    const centerLat = (parseFloat(swLat) + parseFloat(neLat)) / 2;
    const centerLng = (parseFloat(swLng) + parseFloat(neLng)) / 2;
    const geohash = ngeohash.encode(centerLat, centerLng, 6);
    const cacheKey = `map_rides:${geohash}_${rideWindowDays}_days_isRequest_${isRequest}`; // Make cache key unique

    if (redisClient.isReady) {
        const cachedRides = await redisClient.get(cacheKey);
        if (cachedRides) {
          console.log(`CACHE HIT for key: ${cacheKey}`);
          return res.json(JSON.parse(cachedRides));
        }
    }

    console.log(`CACHE MISS for key: ${cacheKey}`);

    // <-- Pass isRequest to the function
    // NEW CALL WITH userId
const ridesData = await getLightweightMapRides({
  swLat, swLng, neLat, neLng, isRequest, 
  userId: req.user.userId, // تمرير معرّف المستخدم
});

    if (redisClient.isReady) {
        await redisClient.set(cacheKey, JSON.stringify(ridesData), {
            EX: 30,
        });
    }

    res.json(ridesData);
  } catch (error) {
    console.error('Get lightweight map rides error:', error);
    res.status(500).json({ error: 'Failed to fetch lightweight map rides' });
  }
});


app.get('/rides/map', authenticate, async (req, res) => {
  try {
    const { swLat, swLng, neLat, neLng } = req.query;
    if (!swLat || !swLng || !neLat || !neLng) {
      return res.status(400).json({ error: 'Map boundaries are required.' });
    }

    const ridesData = await prisma.ride.findMany({
      where: {
        status: 'UPCOMING',
        time: { gte: new Date() },
        OR: [
          {
            AND: [
              { originLat: { gte: parseFloat(swLat), lte: parseFloat(neLat) } },
              { originLng: { gte: parseFloat(swLng), lte: parseFloat(neLng) } },
            ],
          },
          {
            AND: [
              {
                destinationLat: {
                  gte: parseFloat(swLat),
                  lte: parseFloat(neLat),
                },
              },
              {
                destinationLng: {
                  gte: parseFloat(swLng),
                  lte: parseFloat(neLng),
                },
              },
            ],
          },
        ],
      },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            profileImage: true,
            rating: true,
            completedRides: true,
            isVerified: true,
            isPremium: true,
            badges: { include: { badge: true } },
            gender: true,
          },
        },
        car: true,
        bookings: {
          where: { status: { in: ['PENDING', 'ACCEPTED'] } },
        },
        chat: true,
        feedbacks: true,
        interests: { select: { userId: true } },
      },
    });

    const ridesWithComputedSeats = ridesData.map((ride) => {
      const bookedAndPendingSeats = ride.bookings.length;
      const computedAvailableSeats = ride.seats - bookedAndPendingSeats;
      const { bookings, ...rideWithoutBookings } = ride;
      return {
        ...rideWithoutBookings,
        computedAvailableSeats: computedAvailableSeats,
      };
    });

    const availableRides = ridesWithComputedSeats.filter(
      (ride) => ride.computedAvailableSeats > 0
    );

    res.json(availableRides);
  } catch (error) {
    console.error('Get map rides error:', error);
    res.status(500).json({ error: 'Failed to fetch map rides' });
  }
});

// Rides routes
app.get('/rides', authenticate, getAvailableRides);
app.post('/rides', authenticate, [
    // --- START: NEW VALIDATION RULES ---
    body('origin').isString().trim().notEmpty().withMessage('Origin address is required.'),
    body('destination').isString().trim().notEmpty().withMessage('Destination address is required.'),
    body('fromCity').isString().trim().notEmpty().withMessage('Origin city is required.'),
    body('toCity').isString().trim().notEmpty().withMessage('Destination city is required.'),
    body('fromSuburb').optional({ checkFalsy: true }).isString().trim(),
    body('toSuburb').optional({ checkFalsy: true }).isString().trim(),
    body('originLat').isFloat({ min: -90, max: 90 }).withMessage('Invalid origin latitude.'),
    body('originLng').isFloat({ min: -180, max: 180 }).withMessage('Invalid origin longitude.'),
    body('destinationLat').isFloat({ min: -90, max: 90 }).withMessage('Invalid destination latitude.'),
    body('destinationLng').isFloat({ min: -180, max: 180 }).withMessage('Invalid destination longitude.'),
    body('polyline').optional().isString(),
    body('time').isISO8601().toDate().withMessage('Invalid time format.'),
    body('seats').isInt({ min: 1, max: 8 }).withMessage('Seats must be between 1 and 8.'),
    body('price').isFloat({ min: 0, max: 5000 }).withMessage('Price must be a reasonable number.'),
    body('isRequest').isBoolean(),
    body('rideType').isIn(['owner', 'renter', 'request']),
    body('additionalInfo').optional().isString().trim().isLength({ max: 250 }),
    body('allowedGender').isIn(['all', 'male', 'female']),
    // --- END: NEW VALIDATION RULES ---
], createRide);
app.get('/my-rides', authenticate, getUserRides);
app.post('/rides/:id/interest', authenticate, registerInterest);
app.post('/rides/requests/:rideRequestId/offer', authenticate, offerToPickup);
app.put('/rides/:id/price', authenticate, updateRidePrice);
app.get('/rides/:rideId/comments', authenticate, getRideComments);
app.post('/rides/:rideId/comments', authenticate, addRideComment);
app.post('/rides/:rideId/partial-offer', authenticate, async (req, res, next) => {
  try {
    const { rideId } = req.params;
    const passengerId = req.user.userId;
    const { offeredPrice, startLat, startLng, endLat, endLng, startAddress, endAddress } = req.body;

    const offer = await prisma.partialRideOffer.create({
      data: {
        rideId, passengerId, offeredPrice,
        passengerOriginLat: startLat, passengerOriginLng: startLng,
        passengerDestinationLat: endLat, passengerDestinationLng: endLng,
        passengerOriginAddress: startAddress, passengerDestinationAddress: endAddress
      }
    });

    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    const passenger = await prisma.user.findUnique({ where: { id: passengerId } });

    await sendNotificationToUser(ride.driverId, {
      type: 'PARTIAL_RIDE_OFFER',
      relatedId: offer.id,
      data: {
        userName: passenger.name,
        price: offeredPrice,
        from: startAddress,
        to: endAddress,
      }
    });
    res.status(201).json(offer);
  } catch(e) { next(e); }
});

app.post('/partial-offers/:offerId/respond', authenticate, async (req, res, next) => {
  try {
    const { offerId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'
    const driverId = req.user.userId;

    const offer = await prisma.partialRideOffer.findFirst({
      where: { id: offerId, ride: { driverId: driverId }, status: 'PENDING' },
      include: { ride: true, passenger: true }
    });
    if (!offer) return res.status(404).json({ error: 'Offer not found or already handled.'});

    if (action === 'accept') {
      await prisma.$transaction(async (tx) => {
        await tx.partialRideOffer.update({ where: { id: offerId }, data: { status: 'ACCEPTED' }});
        await tx.booking.create({ data: {
          rideId: offer.rideId,
          userId: offer.passengerId,
          status: 'ACCEPTED',
          // You might add more details here to signify it's a partial booking
        }});
        await sendNotificationToUser(offer.passengerId, {
          type: 'PARTIAL_OFFER_ACCEPTED',
          relatedId: offer.rideId,
          data: { driverName: offer.ride.driver.name }
        });
      });
    } else {
      await prisma.partialRideOffer.update({ where: { id: offerId }, data: { status: 'REJECTED' }});
      await sendNotificationToUser(offer.passengerId, {
        type: 'PARTIAL_OFFER_REJECTED',
        relatedId: offer.rideId,
        data: { driverName: offer.ride.driver.name }
      });
    }
    res.json({ message: `Offer ${action}ed.`});
  } catch(e) { next(e); }
});

app.post('/rides/:id/accept', authenticate, async (req, res) => {
  try {
    const { id: rideRequestId } = req.params;
    const driverId = req.user.userId;

    const driver = await prisma.user.findUnique({ where: { id: driverId } });
    if (!driver || !driver.isVerified) {
      return res
        .status(403)
        .json({ error: 'You must be a verified user to accept ride requests.' });
    }

    const rideRequest = await prisma.ride.findUnique({
      where: { id: rideRequestId },
    });
    if (!rideRequest || !rideRequest.isRequest) {
      return res.status(404).json({ error: 'Ride request not found.' });
    }

    const passengerId = rideRequest.driverId; // In requests, the driverId is the passenger

    const newBooking = await prisma.booking.create({
      data: {
        rideId: rideRequestId,
        userId: passengerId,
        seatsBooked: rideRequest.seats,
        status: 'ACCEPTED', // Automatically accepted
      },
    });

    await prisma.ride.update({
      where: { id: rideRequestId },
      data: {
        // A better approach might be to create a NEW ride and link it to the request.
        // For simplicity, we'll just book it. The driver can then see the passenger in their "Your Rides".
      },
    });

    // --- START: MODIFICATION (Socket.io Notification) ---
    // Replaced prisma.notification.create with the new helper
    await sendNotificationToUser(passengerId, {
      title: 'Your ride request was accepted!',
      message: `${driver.name} has accepted your request.`,
      type: 'REQUEST_ACCEPTED',
      userId: passengerId,
      relatedId: rideRequestId,
    });
    // --- END: MODIFICATION ---

    res.status(201).json(newBooking);
  } catch (error) {
    console.error('Accept ride request error:', error);
    res.status(500).json({ error: 'Failed to accept ride request.' });
  }
});

// Get ride details
app.get('/rides/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const ride = await prisma.ride.findUnique({
      where: { id },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            profileImage: true,
            rating: true,
            isVerified: true,
            gender: true,
            completedRides: true,
          },
        },
        car: true,
        bookings: {
          where: { status: { in: ['PENDING', 'ACCEPTED', 'COMPLETED'] } },
          include: {
            user: { select: { id: true, name: true, profileImage: true, isVerified: true } },
          },
        },
        feedbacks: true,
        interests: { select: { userId: true } },
      },
    });

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    const bookedAndPendingSeats = ride.bookings.length;
    const computedAvailableSeats = ride.seats - bookedAndPendingSeats;

    // --- START: MODIFICATION (BUG FIX) ---
    // The original code was filtering out 'COMPLETED' bookings here.
    // This new logic ensures that both ACCEPTED (for upcoming rides) and
    // COMPLETED (for past rides) bookings are sent to the app.
    const relevantBookings = ride.bookings.filter(
      (b) => b.status === 'ACCEPTED' || b.status === 'COMPLETED'
    );

    const finalResponse = {
      ...ride,
      bookings: relevantBookings, // Send the correct list
      computedAvailableSeats,
    };

    res.json(finalResponse);
    // --- END: MODIFICATION ---
  } catch (error) {
    console.error('Get ride details error:', error);
    res.status(500).json({ error: 'Failed to fetch ride details' });
  }
});

// Book a ride
// 1. Initiate a Group Booking Invitation
// NEW, CORRECTED, AND SMARTER LOGIC
app.post('/rides/:id/book', authenticate, async (req, res, next) => {
  try {
    const { id: rideId } = req.params;
    const { passengerIds } = req.body; // Array of user IDs
    const requesterId = req.user.userId;
    
    // Combine requester with other passengers
    const allPassengerIds = [...new Set([requesterId, ...passengerIds])];

    const result = await prisma.$transaction(async (tx) => {
      const ride = await tx.ride.findUnique({ where: { id: rideId } });
      if (!ride) throw new Error('Ride not found');

      // Check verification status for all passengers
      const passengers = await tx.user.findMany({ where: { id: { in: allPassengerIds } } });
      const unverifiedPassenger = passengers.find(p => !p.isVerified);
      if (unverifiedPassenger) {
        throw new Error(`${unverifiedPassenger.name} is not a verified user.`);
      }
      
      // Create bookings for all
      const bookingPromises = allPassengerIds.map(userId => 
        tx.booking.create({
          data: { rideId, userId, status: 'PENDING' }
        })
      );
      const newBookings = await Promise.all(bookingPromises);
      
      // Notify driver
      const requester = passengers.find(p => p.id === requesterId);
      await sendNotificationToUser(ride.driverId, {
        type: 'BOOKING_REQUEST',
        relatedId: newBookings[0].id,
        bookingStatus: 'PENDING',
        data: { userName: `${requester.name} (+${allPassengerIds.length - 1})` },
      });
      
      return newBookings;
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});



// 2. Join a Group Booking
app.post('/invitations/:id/join', authenticate, async (req, res, next) => {
  try {
    const { id: invitationId } = req.params;
    const joinerId = req.user.userId;

    const result = await prisma.$transaction(async (tx) => {
      const invitation = await tx.groupBookingInvitation.findUnique({
        where: { id: invitationId },
        include: { bookings: true, ride: true }
      });

      // --- Validations (no change here) ---
      if (!invitation) throw new Error('Invitation not found.');
      if (invitation.status !== 'PENDING') throw new Error('This invitation is no longer active.');
      if (new Date() > invitation.expiresAt) {
        await tx.groupBookingInvitation.update({ where: { id: invitationId }, data: { status: 'EXPIRED' } });
        throw new Error('This invitation has expired.');
      }
      if (invitation.bookings.length >= invitation.seats) throw new Error('This invitation is already full.');
      if (invitation.bookings.some(b => b.userId === joinerId)) throw new Error('You have already joined this invitation.');

      // **** START: MODIFICATION ****
      // Create the new booking with the temporary status
      await tx.booking.create({
        data: {
          rideId: invitation.rideId,
          userId: joinerId,
          invitationId: invitationId,
          status: 'GROUP_PENDING', // Use the new temporary status
        }
      });
      // **** END: MODIFICATION ****

      const updatedBookingsCount = invitation.bookings.length + 1;

      // If the group is now full
      if (updatedBookingsCount === invitation.seats) {
        // Update invitation status to CONFIRMED
        await tx.groupBookingInvitation.update({
          where: { id: invitationId },
          data: { status: 'CONFIRMED' }
        });
        
        // **** START: MODIFICATION ****
        // Change all temporary bookings to PENDING to be sent to the driver
        const createdBookings = await tx.booking.updateMany({
          where: { invitationId: invitationId },
          data: { status: 'PENDING' }
        });
        // **** END: MODIFICATION ****

        // Notify the driver with one request for the whole group
        const initiator = await tx.user.findUnique({ where: { id: invitation.initiatorId } });
        await sendNotificationToUser(invitation.ride.driverId, {
            type: 'BOOKING_REQUEST',
            relatedId: invitation.id, // Link to the invitation ID
            bookingStatus: 'PENDING',
            data: { userName: `${initiator.name} (+${invitation.seats - 1})` },
        });
      }

      return { success: true, message: 'Successfully joined the ride group.' };
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// 3. Get Invitation and Ride Details
app.get('/invitations/:id', authenticate, async (req, res, next) => {
  try {
    const { id: invitationId } = req.params;

    const invitation = await prisma.groupBookingInvitation.findUnique({
      where: { id: invitationId },
      include: {
        ride: {
          include: {
            driver: {
              select: {
                name: true,
                profileImage: true,
                rating: true,
              }
            }
          }
        },
        bookings: { // لجلب عدد المنضمين حاليًا
          select: {
            userId: true
          }
        }
      }
    });

    if (!invitation) {
      throw new Error('Invitation not found.');
    }

    // التحقق من صلاحية الدعوة قبل إرسال البيانات
    if (new Date() > invitation.expiresAt) {
      throw new Error('This invitation has expired.');
    }
    if (invitation.status !== 'PENDING') {
      throw new Error('This invitation is no longer active.');
    }
 
    res.json(invitation);
  } catch (error) {
    next(error);
  }
});

// Cancel a ride or a booking
app.post('/rides/:id/cancel', authenticate, async (req, res) => {
  try {
    const { id: rideId } = req.params;
    const userId = req.user.userId;

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        bookings: {
          where: { status: 'ACCEPTED' },
          include: { user: { select: { name: true } } },
        },
        driver: { select: { name: true } },
      },
    });

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found.' });
    }
    if (ride.status !== 'UPCOMING') {
      return res.status(400).json({ error: 'Only upcoming rides can be cancelled.' });
    }

    const isDriver = ride.driverId === userId;
    const passengerBooking = ride.bookings.find((b) => b.userId === userId);

    if (!isDriver && !passengerBooking) {
      return res
        .status(403)
        .json({ error: 'You do not have permission to cancel this ride or booking.' });
    }

    await prisma.$transaction(async (tx) => {
      if (isDriver) {
        await tx.ride.update({
          where: { id: rideId },
          data: { status: 'CANCELLED' },
        });
        await updateStatsOnCancellation(userId, tx); // Update driver's cancellation stats
        for (const booking of ride.bookings) {
          // --- START: MODIFICATION (Socket.io Notification) ---
          await sendNotificationToUser(booking.userId, {
  type: 'RIDE_CANCELLED',
  relatedId: rideId,
  data: { from: ride.fromCity, to: ride.toCity },
});
          // --- END: MODIFICATION ---
        }
      } else if (passengerBooking) {
        await tx.booking.update({
          where: { id: passengerBooking.id },
          data: { status: 'CANCELLED' },
        });
        await updateStatsOnCancellation(userId, tx); // Update passenger's cancellation stats
        const groupInvitation = await tx.groupBookingInvitation.findFirst({
  where: { bookings: { some: { id: passengerBooking.id } } }
});

if (groupInvitation && groupInvitation.initiatorId !== userId) {
    await sendNotificationToUser(groupInvitation.initiatorId, {
        type: 'GROUP_MEMBER_CANCELLED', // ستحتاج لإضافة هذا النوع في ملف الترجمة
        relatedId: ride.id,
        data: { userName: passengerBooking.user.name, to: ride.toCity },
    });
}
        // --- START: MODIFICATION (Socket.io Notification) ---
        await sendNotificationToUser(ride.driverId, {
  type: 'BOOKING_CANCELLED',
  relatedId: passengerBooking.id,
  data: { userName: passengerBooking.user.name, to: ride.toCity },
});
        // --- END: MODIFICATION ---
      }
    });

    res.json({ message: 'Cancellation processed successfully.' });
  } catch (error) {
    console.error('Cancel ride/booking error:', error);
    res.status(500).json({ error: 'Failed to process cancellation request.' });
  }
});

// Renter uploads their booking screenshot
app.put(
  '/rides/:id/renter-screenshot',
  authenticate,
  upload.single('screenshot'),
  async (req, res) => {
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

      const driver = await prisma.user.findUnique({ where: { id: ride.driverId }});

      // Send a notification to each interested user
      for (const interest of interestedUsers) {
       await sendNotificationToUser(interest.userId, {
  type: 'RIDE_CONFIRMED',
  relatedId: ride.id,
  data: { from: ride.fromCity, to: ride.toCity },
});
      }

      res.json({ message: 'Screenshot uploaded.', ride: updatedRide });
    } catch (error) {
      console.error('Renter screenshot upload error:', error);
      res.status(500).json({ error: 'Failed to upload screenshot.' });
    }
  }
);

// Republish a completed ride
app.post('/rides/:id/republish', authenticate, async (req, res) => {
  try {
    const { newTime } = req.body;
    if (!newTime) return res.status(400).json({ error: 'A new time is required.' });

    const originalRide = await prisma.ride.findFirst({
      where: { id: req.params.id, driverId: req.user.userId },
    });
    if (!originalRide)
      return res
        .status(404)
        .json({ error: 'Ride not found or you are not the driver.' });

    const { id, createdAt, status, startedAt, arrivedAt, ...newRideData } =
      originalRide;

    const republishedRide = await prisma.ride.create({
      data: {
        ...newRideData,
        time: new Date(newTime),
        status: 'UPCOMING',
      },
    });

    res.status(201).json(republishedRide);
  } catch (error) {
    console.error('Republish ride error:', error);
    res.status(500).json({ error: 'Failed to republish ride.' });
  }
});

// Get booking details by ID
app.get('/bookings/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, profileImage: true } } },
    });

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json(booking);
  } catch (error) {
    console.error('Get booking details error:', error);
    res.status(500).json({ error: 'Failed to fetch booking details' });
  }
});

// Respond to booking request (accept/reject)
app.post('/bookings/:id/respond', authenticate, async (req, res) => {
  const { id: bookingId } = req.params;
  const { action } = req.body;
  const driverId = req.user.userId;

  if (!['accept', 'reject'].includes(action)) {
    return res.status(400).json({ error: "Action must be 'accept' or 'reject'" });
  }

  try {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, ride: { driverId: driverId } },
      include: { ride: true, user: { select: { name: true } } },
    });

    if (!booking) {
      return res
        .status(404)
        .json({ error: 'Booking not found or you are not the driver' });
    }
    if (booking.status !== 'PENDING') {
      return res
        .status(400)
        .json({ error: 'This booking has already been responded to.' });
    }

const responseTimeInMinutes = (new Date() - new Date(booking.createdAt)) / (1000 * 60);
    const FAST_RESPONSE_THRESHOLD_MINUTES = 10; // 10 دقائق
    const isFastResponse = responseTimeInMinutes <= FAST_RESPONSE_THRESHOLD_MINUTES;

    let result;

    if (action === 'accept') {
      result = await prisma.$transaction(async (tx) => {
        const updatedBooking = await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'ACCEPTED' },
        });

        await updateStatsOnBookingResponse(bookingId, 'ACCEPTED', isFastResponse, tx);
        await tx.notification.updateMany({
          where: {
            relatedId: bookingId,
            userId: driverId,
            type: 'BOOKING_REQUEST',
          },
          data: { isRead: true },
        });

        await updateStatsOnBookingResponse(bookingId, 'ACCEPTED', tx);

        let chat = await tx.chat.findUnique({ where: { rideId: booking.rideId } });
        if (!chat) {
          chat = await tx.chat.create({
            data: {
              rideId: booking.rideId,
              members: { create: { userId: driverId } },
            },
          });
        }

        await tx.chatMember.create({
          data: { chatId: chat.id, userId: booking.userId, bookingId: booking.id },
        });

        if (
          booking.ride.rideType === 'renter' &&
          booking.ride.renterScreenshotUrl
        ) {
          await tx.message.create({
            data: {
              content: booking.ride.renterScreenshotUrl,
              type: 'image',
              chatId: chat.id,
              userId: driverId,
            },
          });
        }
        
        await sendNotificationToUser(booking.userId, {
      type: 'BOOKING_ACCEPTED',
      relatedId: chat.id, // This is the chatId
      bookingStatus: 'ACCEPTED',
      rideId: booking.rideId, // <-- The crucial fix
      data: { to: booking.ride.toCity },
    });

        return { booking: updatedBooking, chat };
      });
    } else {
      // action === 'reject'
      result = await prisma.$transaction(async (tx) => {
        const updatedBooking = await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'REJECTED' },
        });

        await updateStatsOnBookingResponse(bookingId, 'REJECTED', isFastResponse, tx);
        await tx.notification.updateMany({
            where: {
              relatedId: bookingId,
              userId: driverId,
              type: 'BOOKING_REQUEST',
            },
            data: { isRead: true },
        });

        await updateStatsOnBookingResponse(bookingId, 'REJECTED', tx);

        await sendNotificationToUser(booking.userId, {
  type: 'BOOKING_REJECTED',
  relatedId: booking.rideId,
  bookingStatus: 'REJECTED',
  data: { to: booking.ride.toCity },
});

        return { booking: updatedBooking };
      });
    }

    res.json({
      message: `Booking ${action}ed`,
      booking: result.booking,
      chat: result.chat || null,
    });
  } catch (error) {
    next(error);
  }
});

// -------- Chat & Support --------

app.post('/support/chats', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });

    if (!adminUser) {
      return res.status(500).json({ error: 'Support service is currently unavailable.' });
    }
    const adminId = adminUser.id;

    const existingChat = await prisma.chat.findFirst({
      where: {
        rideId: null, // Ensure it's a support chat
        AND: [ { members: { some: { userId: userId } } }, { members: { some: { userId: adminId } } } ],
      },
    });

    if (existingChat) {
      return res.status(200).json(existingChat);
    }

    const newChat = await prisma.chat.create({
      data: {
        members: { create: [{ userId: userId }, { userId: adminId }] },
      },
    });

    // --- START: ADD THIS NOTIFICATION LOGIC ---
    await sendNotificationToUser(adminId, {
        title: "New Support Chat",
        message: `A user has started a new support conversation.`,
        type: 'NEW_SUPPORT_MESSAGE', // A new, specific type
        userId: adminId,
        relatedId: newChat.id, // Link to the chat ID
    });
    // --- END: ADD THIS NOTIFICATION LOGIC ---

    res.status(201).json(newChat);
  } catch (error) {
    console.error('Create support chat error:', error);
    res.status(500).json({ error: 'Failed to create support chat' });
  }
});

app.post('/chats/:chatId/start-ride', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const currentUserId = req.user.userId;

    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: { ride: true, members: true },
    });

    // 1. Check if the ride exists and the user is the driver
    if (!chat || !chat.ride || chat.ride.driverId !== currentUserId) {
      return res.status(403).json({ error: 'Only the driver can start this ride.' });
    }

    if (chat.ride.status === 'UPCOMING') {
      // 2. Immediately update the ride status to IN_PROGRESS
      const updatedRide = await prisma.ride.update({
        where: { id: chat.ride.id },
        data: { status: 'IN_PROGRESS', startedAt: new Date() },
      });

      // 3. Emit event to all members
      for (const chatMember of chat.members) {
        const memberSocketIds = userSockets.get(chatMember.userId);
        if (memberSocketIds) {
          for (const socketId of memberSocketIds) {
            io.to(socketId).emit('ride_status_updated', {
              chatId: chatId,
              rideId: updatedRide.id,
              status: updatedRide.status,
            });
          }
        }
        await sendNotificationToUser(chatMember.userId, {
          type: 'RIDE_STARTED',
          relatedId: chat.ride.id,
          data: { from: chat.ride.fromCity, to: chat.ride.toCity },
        });
      }
    }
    res.json({ message: 'Ride has been started successfully.' });
  } catch (error) {
    console.error('Start ride from chat error:', error);
    res.status(500).json({ error: 'Server error while starting ride.' });
  }
});

app.post('/chats/:chatId/end-ride', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const member = await prisma.chatMember.findFirst({
      where: { chatId, userId: req.user.userId },
    });
    if (!member) return res.status(403).json({ error: 'You are not a member of this chat.' });

    await prisma.chatMember.update({
      where: { id: member.id },
      data: { hasEnded: true },
    });

    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        members: { include: { user: true } },
        ride: { include: { driver: true, bookings: { where: { status: 'ACCEPTED' }, include: { user: true } } } },
      },
    });
    const allEnded = chat.members.every((m) => m.hasEnded);

    if (allEnded && chat.ride && chat.ride.status === 'IN_PROGRESS') {
      await prisma.$transaction(async (tx) => {
        const updatedRide = await tx.ride.update({
          where: { id: chat.ride.id },
          data: { status: 'COMPLETED', arrivedAt: new Date() },
        });

        await tx.booking.updateMany({
          where: { rideId: chat.ride.id, status: 'ACCEPTED' },
          data: { status: 'COMPLETED' },
        });

        await updateStatsOnRideCompletion(chat.ride.id, tx);

        if (updatedRide.rideType === 'renter' && updatedRide.receiptPrice != null && updatedRide.receiptPrice > 0) {
          const acceptedBookings = await tx.booking.findMany({
            where: { rideId: updatedRide.id, status: 'COMPLETED' }
          });
          
          const totalPeople = acceptedBookings.length + 1; // Passengers + Driver
          const pricePerPerson = updatedRide.receiptPrice / totalPeople;

          const billMessage = `The total cost was ${updatedRide.receiptPrice} EGP, split among ${totalPeople} people. Your share is ${pricePerPerson.toFixed(2)} EGP.`;
          
          // Send bill notification to the driver
          await sendNotificationToUser(updatedRide.driverId, {
            title: "Ride Bill Calculated",
            message: billMessage,
            type: "RIDE_BILL",
            userId: updatedRide.driverId,
            relatedId: updatedRide.id,
          });
          
          // Send bill notification to each passenger
          for (const booking of acceptedBookings) {
            await sendNotificationToUser(booking.userId, {
  type: "RIDE_BILL_CALCULATED", // اسم النوع الصحيح من ملف الترجمة
  relatedId: updatedRide.id,
  data: {
    totalPrice: updatedRide.receiptPrice.toFixed(2),
    totalPeople: totalPeople,
    pricePerPerson: pricePerPerson.toFixed(2),
  },
});
          }
        }

        // Emit event to all members
        for (const chatMember of chat.members) {
           const memberSocketIds = userSockets.get(chatMember.userId);
            if (memberSocketIds) {
              for(const socketId of memberSocketIds){
                io.to(socketId).emit('ride_status_updated', {
                    chatId: chatId,
                    rideId: updatedRide.id,
                    status: updatedRide.status,
                });
              }
            }
          // Send feedback notifications
          if (chatMember.userId === chat.ride.driverId) {
            for(const booking of chat.ride.bookings) {
                 await sendNotificationToUser(chatMember.userId, {
                    title: "Leave Feedback",
                    message: `How was your ride with ${booking.user.name}? Please leave feedback.`,
                    type: "LEAVE_FEEDBACK",
                    userId: chatMember.userId,
                    relatedId: chat.ride.id,
                 });
            }
          } else {
            await sendNotificationToUser(chatMember.userId, {
              title: "Leave Feedback",
              message: `How was your ride with ${chat.ride.driver.name}? Please leave feedback.`,
              type: "LEAVE_FEEDBACK",
              userId: chatMember.userId,
              relatedId: chat.ride.id,
            });
          }
        }
      });
    }

    res.json({ message: 'Confirmation received.' });
  } catch (error) {
    console.error('End ride from chat error:', error);
    res.status(500).json({ error: 'Server error while ending ride.' });
  }
});

app.get('/chats', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    let chats = await prisma.chat.findMany({
      where: { members: { some: { userId: userId } } },
      include: {
        ride: {
          include: {
            driver: { select: { id: true, name: true, profileImage: true } },
          },
        },
        members: {
          include: {
            user: { select: { id: true, name: true, profileImage: true } },
          },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    // --- START: NEW LOGIC ---
    // 1. Enrich each chat with its unread status
    const enrichedChats = await Promise.all(
      chats.map(async (chat) => {
        const unreadCount = await prisma.notification.count({
          where: {
            userId: userId,
            relatedId: chat.id,
            type: 'NEW_MESSAGE',
            isRead: false,
          },
        });
        // Add unreadCount to each chat object
        return { ...chat, unreadCount };
      })
    );

    // 2. Sort chats: unread chats first, then by the most recent message
    enrichedChats.sort((a, b) => {
      // Prioritize unread chats
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
      if (b.unreadCount > 0 && a.unreadCount === 0) return 1;
      
      // If both are read or unread, sort by the newest message time
      const a_time = a.messages.length > 0 ? new Date(a.messages[0].createdAt).getTime() : 0;
      const b_time = b.messages.length > 0 ? new Date(b.messages[0].createdAt).getTime() : 0;
      return b_time - a_time; // Descending order
    });
    // --- END: NEW LOGIC ---

    res.json(enrichedChats);
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.get('/chats/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const chat = await prisma.chat.findFirst({
      where: { id: id, members: { some: { userId: req.user.userId } } },
      include: {
        messages: {
          include: { user: { select: { id: true, name: true, profileImage: true } } },
          orderBy: { createdAt: 'asc' },
        },
        members: {
          include: { user: true },
        },
        ride: {
          include: {
            driver: {
              select: { id: true, name: true, profileImage: true, rating: true },
            },
          },
        },
      },
    });
    if (!chat)
      return res.status(404).json({ error: 'Chat not found or access denied' });

    const isMember = chat.members.some((m) => m.userId === req.user.userId);
    if (chat.ride && chat.ride.isAnonymous && isMember) {
    } else if (chat.ride && chat.ride.isAnonymous) {
      chat.ride.driver.name = 'Anonymous';
      chat.ride.driver.profileImage = null;
    }

    res.json(chat);
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({ error: 'Failed to fetch chat' });
  }
});

// السطور الجديدة المطلوب إضافتها
app.post('/chats/:id/messages', authenticate, upload.single('audio'), async (req, res) => {
  try {
    const { id: chatId } = req.params;
    const { content } = req.body; // For text messages
    const userId = req.user.userId;

    const member = await prisma.chatMember.findFirst({ where: { chatId, userId } });
    if (!member) return res.status(403).json({ error: 'You are not a member of this chat' });
    
    // **** START: MODIFICATION ****
    let messageContent = content;
    let messageType = "text";

    // If there is an audio file, it means it's a voice message
    if (req.file) {
      messageContent = req.file.path; // The Cloudinary URL
      messageType = "audio";
    }
    
    if (!messageContent) {
        return res.status(400).json({ error: 'Message content is empty' });
    }
    // **** END: MODIFICATION ****

    const { parentId } = req.body; // Get parentId from the request body

    const message = await prisma.message.create({
      data: {
        content: messageContent,
        type: messageType,
        chatId,
        userId,
        parentId: parentId, // Save the parentId if it exists
      },
      // Include the user, and also the parent message with its user's name
      include: {
        user: { select: { id: true, name: true, profileImage: true } },
        parent: {
          include: {
            user: { select: { name: true } }
          }
        }
      },
    });
    
    const chat = await prisma.chat.findUnique({ where: { id: chatId }, include: { members: true }});
    const sender = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });

    for (const member of chat.members) {
      const userSocketIds = userSockets.get(member.userId);
      if (userSocketIds && userSocketIds.size > 0) {
        for (const socketId of userSocketIds) {
          // Check if the recipient is an admin to send a special event
          const recipient = await prisma.user.findUnique({ where: { id: member.userId }, select: { role: true }});
          if (recipient && recipient.role === 'ADMIN' && chat.rideId === null) {
            io.to(socketId).emit('admin_new_support_message', { chatId: chatId, message: message });
          } else {
            io.to(socketId).emit('new_message', message);
          }
        }
      }
    }

    // 2. إرسال إشعارات Push فقط للأعضاء الآخرين
    for (const otherMember of chat.members) {
      // تخطي المرسل نفسه
      if (otherMember.userId === userId) continue;

      const notificationType = chat.rideId === null ? 'NEW_SUPPORT_MESSAGE' : 'NEW_MESSAGE';
      
      // إنشاء نص آمن للإشعار
      const notificationContent = message.type === 'audio' 
        ? 'أرسل رسالة صوتية' // نص ثابت للرسائل الصوتية
        : (message.content.length > 50 ? message.content.substring(0, 50) + '...' : message.content);

      await sendNotificationToUser(otherMember.userId, {
        type: notificationType,
        relatedId: chatId,
        data: { 
          senderName: sender.name,
          content: notificationContent,
        },
      });
    }

    res.status(201).json(message);
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Mark all messages in a chat as read
app.post('/chats/:chatId/read', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.userId;

    await prisma.notification.updateMany({
      where: {
        userId: userId,
        relatedId: chatId,
        type: 'NEW_MESSAGE',
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });

    res.status(200).json({ message: 'Chat marked as read' });
  } catch (error) {
    console.error('Mark chat as read error:', error);
    res.status(500).json({ error: 'Failed to mark chat as read' });
  }
});

// -------- Notifications, Feedback, Wallet & Subscription --------
app.get('/notifications', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;

    const notifications = await prisma.notification.findMany({
      where: {
        userId: userId,
        type: { not: 'NEW_MESSAGE' },
      },
      orderBy: { createdAt: 'desc' },
    });

    const bookingRequestNotifIds = notifications
        .filter(n => n.type === 'BOOKING_REQUEST' && n.relatedId)
        .map(n => n.relatedId);
    
    let bookingStatuses = {};
    if (bookingRequestNotifIds.length > 0) {
        const bookings = await prisma.booking.findMany({
            where: { id: { in: bookingRequestNotifIds } },
            select: { id: true, status: true }
        });
        bookings.forEach(b => {
            bookingStatuses[b.id] = b.status;
        });
    }

    const enrichedNotifications = notifications.map(n => {
        if (n.type === 'BOOKING_REQUEST' && n.relatedId && bookingStatuses[n.relatedId]) {
            return { ...n, bookingStatus: bookingStatuses[n.relatedId] };
        }
        return n;
    });

    res.json(enrichedNotifications);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.put('/notifications/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const updatedNotification = await prisma.notification.updateMany({
      where: {
        id: id,
        userId: req.user.userId,
      },
      data: { isRead: true },
    });
    res.json(updatedNotification);
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

app.post('/feedback', authenticate, [
    body('rideId').isString().notEmpty(),
    body('receivedById').isString().notEmpty(),
    body('rating').isInt({ min: 1, max: 5 }),
    body('comment').optional().isString(),
], async (req, res, next) => {
  try {
    // --- [تمت الإضافة] --- التحقق من نتائج الـ validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // --- ** بداية الإضافة: استقبال البيانات الجديدة ** ---
    const { rideId, receivedById, rating, comment, startOnTime, arrivalOnTime } = req.body;
    const givenById = req.user.userId;

    await prisma.$transaction(async (tx) => {
      await tx.feedback.create({
        data: {
          rideId,
          receivedById,
          givenById,
          rating: parseInt(rating),
          comment,
          startOnTime,   // <-- حفظ القيمة الجديدة
          arrivalOnTime, // <-- حفظ القيمة الجديدة
        },
      });

      const feedbacks = await tx.feedback.findMany({
        where: { receivedById },
        select: { rating: true },
      });

      const totalRating = feedbacks.reduce((sum, f) => sum + f.rating, 0);
      const averageRating = totalRating / feedbacks.length;

      await tx.user.update({
        where: { id: receivedById },
        data: { rating: parseFloat(averageRating.toFixed(2)) },
      });

      // --- ** بداية الإضافة: تحديث إحصائيات الالتزام بالوقت ** ---
      await _ensureUserStats(receivedById, tx); // التأكد من وجود سجل إحصائيات
      const statsUpdateData = {};
      if (startOnTime === true) {
        statsUpdateData.onTimeStarts = { increment: 1 };
      }
      if (arrivalOnTime === true) {
        statsUpdateData.onTimeArrivals = { increment: 1 };
      }
      
      if (Object.keys(statsUpdateData).length > 0) {
        await tx.userStats.update({
          where: { userId: receivedById },
          data: statsUpdateData
        });
      }
      // --- ** نهاية الإضافة ** ---
    });

    res.status(201).json({ message: 'Feedback submitted and rating updated.' });
  } catch (error) {
    console.error('Submit feedback error:', error);
    next(error);
  }
});

// تأكد من وجود هذه الدالة المساعدة في نفس الملف أو قم باستيرادها
const _ensureUserStats = async (userId, tx = prisma) => {
  await tx.userStats.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
};

// *** الحذف ***: تم حذف جميع نقاط النهاية (endpoints) المتعلقة بطلبات شحن الرصيد.

app.post('/profile/subscribe-premium', authenticate, subscribePremium);
app.post('/profile/cancel-autorenew', authenticate, cancelAutoRenew);

// Payment methods endpoints
app.get('/config/payment-methods', authenticate, async (req, res) => {
  try {
    const keys = ['INSTAPAY_INFO', 'VODAFONE_CASH_NUMBER', 'ORANGE_CASH_NUMBER'];
    const configs = await prisma.appConfig.findMany({
      where: { key: { in: keys } },
    });
    res.json(configs);
  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({ error: 'Failed to fetch payment methods' });
  }
});

app.post('/api/geocode/reverse', authenticate, async (req, res) => {
  // [MODIFICATION] Read the language from the request body, default to 'en'
  const { lat, lng, lang = 'en' } = req.body;

  if (lat == null || lng == null) {
    return res
      .status(400)
      .json({ error: 'Latitude and Longitude are required.' });
  }

  try {
    // [MODIFICATION] Use the 'lang' variable in the Nominatim URL
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=${lang}`;
    const response = await axios.get(nominatimUrl, {
      headers: { 'User-Agent': 'RideShareApp/1.0' },
    });
    if (response.data && !response.data.error) {
      console.log(`Geocoding successful with Nominatim (lang: ${lang}).`);
      return res.json(response.data);
    }
  } catch (nominatimError) {
    console.error('Nominatim failed, trying Google Maps fallback...');
  }

  try {
    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey) {
      throw new Error('Google Maps API Key is not configured on the server.');
    }
    // [MODIFICATION] Use the 'lang' variable in the Google Maps URL
    const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleApiKey}&language=${lang}`;
    const response = await axios.get(googleUrl);

    const { results } = response.data;
    if (results && results.length > 0) {
      console.log('Geocoding successful with Google Maps fallback.');
      const firstResult = results[0];

      const addressComponents = {};
      firstResult.address_components.forEach((component) => {
        if (component.types.includes('administrative_area_level_2'))
          addressComponents.city = component.long_name;
        if (
          component.types.includes('sublocality') ||
          component.types.includes('neighborhood')
        )
          addressComponents.suburb = component.long_name;
        if (component.types.includes('route'))
          addressComponents.road = component.long_name;
        if (component.types.includes('country'))
          addressComponents.country = component.long_name;
      });

      const formattedResponse = {
        display_name: firstResult.formatted_address,
        address: addressComponents,
      };
      return res.json(formattedResponse);
    }
  } catch (googleError) {
    console.error('Google Maps fallback also failed:', googleError.message);
  }

  return res.status(503).json({
    error: 'GEOCODING_SERVICES_UNAVAILABLE',
    message: 'Could not retrieve address from any service.',
  });
});

// -------- Admin Routes --------
app.use('/admin', adminRoutes);

app.get('/admin/chats', authenticate, requireAdmin, async (req, res) => {
  try {
    const chats = await prisma.chat.findMany({
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    res.json(chats);
  } catch (error) {
    console.error('Admin get chats error:', error);
    res.status(500).json({ error: 'Failed to fetch all chats' });
  }
});

app.put(
  '/admin/config/payment-methods',
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const { instapay, vodafone, orange } = req.body;
      const updates = [
        prisma.appConfig.upsert({
          where: { key: 'INSTAPAY_INFO' },
          update: { value: instapay || '' },
          create: { key: 'INSTAPAY_INFO', value: instapay || '' },
        }),
        prisma.appConfig.upsert({
          where: { key: 'VODAFONE_CASH_NUMBER' },
          update: { value: vodafone || '' },
          create: { key: 'VODAFONE_CASH_NUMBER', value: vodafone || '' },
        }),
        prisma.appConfig.upsert({
          where: { key: 'ORANGE_CASH_NUMBER' },
          update: { value: orange || '' },
          create: { key: 'ORANGE_CASH_NUMBER', value: orange || '' },
        }),
      ];
      await prisma.$transaction(updates);
      res.json({ message: 'Payment methods updated successfully.' });
    } catch (error) {
      console.error('Update payment methods error:', error);
      res.status(500).json({ error: 'Failed to update payment methods' });
    }
  }
);

app.get('/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: { car: true, rides: true, bookings: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (error) {
    console.error('Get admin users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post(
  '/admin/users/:userId/verify',
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const { status } = req.body;
      if (!['APPROVED', 'REJECTED'].includes(status)) {
        return res
          .status(400)
          .json({ error: 'Status must be APPROVED or REJECTED.' });
      }

      const isVerified = status === 'APPROVED';
      const user = await prisma.user.update({
        where: { id: req.params.userId },
        data: {
          isVerified: isVerified,
          idVerificationStatus: status,
        },
      });

      await sendNotificationToUser(user.id, {
        title: `Identity Verification ${isVerified ? 'Approved' : 'Rejected'}`,
        message: `Your identity documents have been reviewed. Status: ${status}.`,
        type: 'ID_VERIFICATION',
        userId: user.id,
      });

      res.json({ message: `User verification status updated to ${status}.` });
    } catch (error) {
      res.status(500).json({ error: 'Failed to update user verification.' });
    }
  }
);

app.post(
  '/admin/cars/:carId/verify',
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      const { status } = req.body;
      if (!['APPROVED', 'REJECTED'].includes(status)) {
        return res
          .status(400)
          .json({ error: 'Status must be APPROVED or REJECTED.' });
      }
      const isVerified = status === 'APPROVED';
      await prisma.car.update({
        where: { id: req.params.carId },
        data: {
          isVerified: isVerified,
          verificationStatus: status,
        },
      });
      res.json({ message: 'Car verification status updated' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to verify car' });
    }
  }
);

if (process.env.NODE_ENV !== 'test') {
cron.schedule('0 1 * * *', async () => {
  console.log('Running daily check for expired licenses...');
  try {
    const now = new Date();
    const updatedCars = await prisma.car.updateMany({
      where: {
        isVerified: true,
        licenseExpiryDate: {
          lt: now,
        },
      },
      data: {
        isVerified: false,
        verificationStatus: 'REJECTED',
      },
    });
    if (updatedCars.count > 0) {
      console.log(
        `Deactivated ${updatedCars.count} car(s) due to expired licenses.`
      );
    }
  } catch (error) {
    console.error('Error in expired license cron job:', error);
  }
});

// --- [تمت الإضافة] --- المهمة المجدولة الجديدة
cron.schedule('*/5 * * * *', async () => {
    console.log('Running scheduled rides processor...');
    try {
        await processScheduledRides();
    } catch (error) {
        console.error('Error in scheduled rides cron job:', error);
    }
});
}

cron.schedule('* * * * *', async () => { // This runs every minute
  console.log('Running cron job to clean up expired group invitations...');
  try {
    const expiredInvitations = await prisma.groupBookingInvitation.findMany({
      where: {
        status: 'PENDING',
        expiresAt: {
          lt: new Date(), // Find invitations where the expiry time is in the past
        },
      },
    });

    if (expiredInvitations.length > 0) {
      const invitationIds = expiredInvitations.map(inv => inv.id);
      
      // Use a transaction to ensure atomicity
      await prisma.$transaction([
        // Delete all temporary bookings associated with these expired invitations
        prisma.booking.deleteMany({
          where: {
            invitationId: { in: invitationIds },
            status: 'GROUP_PENDING',
          },
        }),
        // Update the invitations themselves to an EXPIRED status
        prisma.groupBookingInvitation.updateMany({
          where: {
            id: { in: invitationIds },
          },
          data: {
            status: 'EXPIRED',
          },
        }),
      ]);
      console.log(`Cleaned up ${expiredInvitations.length} expired invitations.`);
    }
  } catch (error) {
    console.error('Error in expired invitations cron job:', error);
  }
});

// --- [تمت الإضافة] --- معالج الأخطاء المركزي
const errorHandler = (error, req, res, next) => {
    console.error("An error occurred: ", error.message);

    // Handle Prisma Errors
    if (error.code) {
        switch (error.code) {
            case 'P2002':
                return res.status(409).json({ message: 'A record with this data already exists.', field: error.meta?.target?.[0] });
            case 'P2025':
                return res.status(404).json({ message: 'The requested record was not found.' });
            default:
                return res.status(500).json({ message: 'A database error occurred.' });
        }
    }

    // Handle Validation Errors from express-validator
    if (Array.isArray(error.errors)) {
        return res.status(400).json({ message: "Validation failed", errors: error.errors });
    }

    // Generic Error
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ message: error.message || 'An internal server error occurred.' });

  // **** START: NEW CRON JOB ****
  // This job runs at the start of every hour to cancel overdue rides
  cron.schedule('0 * * * *', async () => {
    console.log('Running job to cancel overdue upcoming rides...');
    try {
      // Set the cutoff time to 12 hours ago
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

      // Find all upcoming rides that are more than 12 hours late
      const overdueRides = await prisma.ride.findMany({
        where: {
          status: 'UPCOMING',
          time: {
            lt: twelveHoursAgo, // time is less than 12 hours ago
          },
        },
        include: {
          bookings: {
            where: { status: 'ACCEPTED' },
          },
        },
      });

      if (overdueRides.length > 0) {
        const rideIdsToCancel = overdueRides.map(ride => ride.id);

        // Update the status of these rides to CANCELLED in the database
        await prisma.ride.updateMany({
          where: {
            id: { in: rideIdsToCancel },
          },
          data: {
            status: 'CANCELLED',
          },
        });

        console.log(`Automatically cancelled ${overdueRides.length} overdue ride(s).`);

        // Send notifications to the driver and passengers of each cancelled ride
        for (const ride of overdueRides) {
          // Notify the driver
          await sendNotificationToUser(ride.driverId, {
            type: 'RIDE_AUTO_CANCELLED', // A new notification type
            relatedId: ride.id,
            data: { from: ride.fromCity, to: ride.toCity },
          });

          // Notify accepted passengers
          for (const booking of ride.bookings) {
            await sendNotificationToUser(booking.userId, {
              type: 'RIDE_AUTO_CANCELLED',
              relatedId: ride.id,
              data: { from: ride.fromCity, to: ride.toCity },
            });
          }
        }
      }
    } catch (error) {
      console.error('Error in auto-cancelling overdue rides cron job:', error);
    }
  });
  // **** END: NEW CRON JOB ****
}

app.use(errorHandler);


if (process.env.NODE_ENV !== 'test') {
    server.listen(PORT, () => {
        console.log(`API running on http://localhost:${PORT}`);
    });
}

export { app, server };
