// src/controllers/adminController.js

import { prisma } from '../prisma.js';
import { sendNotificationToUser } from '../server.js';
import { io } from '../io.js';
import { userSockets } from '../server.js';


// This function gets a list of users with pagination for React Admin
export const getUsers = async (req, res) => {
  try {
    // React Admin sends pagination info in query parameters
    const { _start = 0, _end = 10, _sort = 'createdAt', _order = 'DESC' } = req.query;
    const skip = parseInt(_start);
    const take = parseInt(_end) - skip;

    const users = await prisma.user.findMany({
      skip: skip,
      take: take,
      orderBy: {
        [_sort]: _order.toLowerCase(),
      },
    });

    const totalUsers = await prisma.user.count();

    // This header is CRUCIAL for React Admin to understand pagination
    res.setHeader('Content-Range', `users ${skip}-${skip + users.length - 1}/${totalUsers}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range'); // Allow browser to read the header

    res.status(200).json(users);
  } catch (error) {
    console.error("Admin: Get Users Error:", error);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
};

// Function to get a single user's details (for the Edit page)
export const getUser = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await prisma.user.findUnique({
            where: { id },
            include: { car: true }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }
        res.status(200).json(user);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user.' });
    }
};

// Function to handle updates for a user from the admin panel
export const updateUser = async (req, res) => {
    const { id } = req.params;
    const { name, email, phone, isVerified, isPremium } = req.body;
    try {
        const updatedUser = await prisma.user.update({
            where: { id },
            data: { name, email, phone, isVerified, isPremium },
        });
        res.status(200).json(updatedUser); // Return the updated record
    } catch (error) {
        res.status(500).json({ error: 'Failed to update user.' });
    }
};

export const getVerificationRequests = async (req, res) => {
  try {
    const userRequests = await prisma.user.findMany({
      where: { idVerificationStatus: 'PENDING' },
    });

    const carRequests = await prisma.car.findMany({
      where: { verificationStatus: 'PENDING' },
      // Include the full user object to access drivingLicenseUrl
      include: { user: true }, 
    });

    const formattedUserRequests = userRequests.map(u => ({ ...u, id: `user_${u.id}`, originalId: u.id, type: 'USER' }));
    const formattedCarRequests = carRequests.map(c => ({ ...c, id: `car_${c.id}`, originalId: c.id, type: 'CAR' }));
    
    const allRequests = [...formattedUserRequests, ...formattedCarRequests];
    
    res.setHeader('Content-Range', `verifications 0-${allRequests.length - 1}/${allRequests.length}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
    res.status(200).json(allRequests);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch verification requests.' });
  }
};

// Function to approve or reject a USER verification
export const respondToUserVerification = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; 

    if (!['APPROVED', 'REJECTED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status provided.' });
    }

    try {
        const updatedUser = await prisma.user.update({
            where: { id },
            data: {
                idVerificationStatus: status,
                isVerified: status === 'APPROVED',
            },
        });

        // --- START: NEW NOTIFICATION LOGIC ---
        await sendNotificationToUser(updatedUser.id, {
  type: 'ID_VERIFICATION',
  relatedId: updatedUser.id,
  data: { status: status },
});
        // --- END: NEW NOTIFICATION LOGIC ---

        res.status(200).json(updatedUser);
    } catch (error) {
        console.error(`Admin: Respond to User Verification Error:`, error);
        res.status(500).json({ error: 'Failed to update user verification status.' });
    }
};

// Function to approve or reject a CAR verification
export const respondToCarVerification = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!['APPROVED', 'REJECTED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status provided.' });
    }

    try {
        const updatedCar = await prisma.car.update({
            where: { id },
            data: {
                verificationStatus: status,
                isVerified: status === 'APPROVED',
            },
        });

        // --- START: NEW NOTIFICATION LOGIC ---
        await sendNotificationToUser(updatedCar.userId, {
  type: 'CAR_VERIFICATION',
  relatedId: updatedCar.id,
  data: { status: status },
});
        // --- END: NEW NOTIFICATION LOGIC ---

        res.status(200).json(updatedCar);
    } catch (error) {
        console.error(`Admin: Respond to Car Verification Error:`, error);
        res.status(500).json({ error: 'Failed to update car verification status.' });
    }
};

// Function to get a list of VERIFIED users with pagination and search
export const getVerifiedUsers = async (req, res) => {
  try {
    const { q, _start = 0, _end = 10, _sort = 'createdAt', _order = 'DESC' } = req.query;
    const skip = parseInt(_start);
    const take = parseInt(_end) - skip;

    const whereClause = {
      idVerificationStatus: 'APPROVED', // The main filter for this resource
    };

    // If a search query is provided, filter by name or email
    if (q) {
      whereClause.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where: whereClause,
      skip: skip,
      take: take,
      orderBy: {
        [_sort]: _order.toLowerCase(),
      },
    });

    const totalCount = await prisma.user.count({ where: whereClause });

    res.setHeader('Content-Range', `verified-users ${skip}-${skip + users.length - 1}/${totalCount}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
    res.status(200).json(users);
  } catch (error) {
    console.error("Admin: Get Verified Users Error:", error);
    res.status(500).json({ error: 'Failed to fetch verified users.' });
  }
};

export const getVerifiedCars = async (req, res) => {
  try {
    const { q, _start = 0, _end = 10, _sort = 'createdAt', _order = 'DESC' } = req.query;
    const skip = parseInt(_start);
    const take = parseInt(_end) - skip;

    const whereClause = {
      verificationStatus: 'APPROVED', // Filter for approved cars
    };

    if (q) {
      whereClause.OR = [
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { plate: { contains: q, mode: 'insensitive' } },
      ];
    }

    const cars = await prisma.car.findMany({
      where: whereClause,
      include: { user: { select: { name: true } } },
      skip: skip,
      take: take,
      orderBy: { [_sort]: _order.toLowerCase() },
    });

    const totalCount = await prisma.car.count({ where: whereClause });

    res.setHeader('Content-Range', `verified-cars ${skip}-${skip + cars.length - 1}/${totalCount}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
    res.status(200).json(cars);
  } catch (error) {
    console.error("Admin: Get Verified Cars Error:", error);
    res.status(500).json({ error: 'Failed to fetch verified cars.' });
  }
};

// Function to get a single user's details (needed for the show/details page)
export const getVerifiedUser = async (req, res) => {
    try {
        const { id } = req.params;
        const user = await prisma.user.findUnique({
            where: { id },
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }
        res.status(200).json(user);
    } catch (error) {
        console.error("Admin: Get Verified User Error:", error);
        res.status(500).json({ error: 'Failed to fetch user.' });
    }
};

// Function to get a list of all rides with pagination and filters
export const getRides = async (req, res) => {
  try {
    const { _start = 0, _end = 10, _sort = 'time', _order = 'DESC', status, rideType, q } = req.query;
    const skip = parseInt(_start);
    const take = parseInt(_end) - skip;

    const whereClause = {};

    if (status) whereClause.status = status.toUpperCase();
    if (rideType) whereClause.rideType = rideType;
    if (q) {
      whereClause.driver = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const rides = await prisma.ride.findMany({
      where: whereClause,
      include: { driver: { select: { name: true } } },
      skip,
      take,
      orderBy: { [_sort]: _order.toLowerCase() },
    });

    const totalCount = await prisma.ride.count({ where: whereClause });

    // --- START: SAFETY MODIFICATION ---
    // Use optional chaining (?.) to prevent crash if driver is null
    const formattedRides = rides.map(ride => ({
        ...ride,
        driver_name: ride.driver?.name || 'N/A' 
    }));
    // --- END: SAFETY MODIFICATION ---

    res.setHeader('Content-Range', `rides ${skip}-${skip + formattedRides.length - 1}/${totalCount}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
    res.status(200).json(formattedRides);
  } catch (error) {
    console.error("Admin: Get Rides Error:", error);
    res.status(500).json({ error: 'Failed to fetch rides.' });
  }
};

// Function to get a single ride's details
export const getRide = async (req, res) => {
    try {
        const { id } = req.params;
        const ride = await prisma.ride.findUnique({
            where: { id },
            include: { driver: true, car: true, bookings: { include: { user: true } } },
        });
        if (!ride) {
            return res.status(404).json({ error: 'Ride not found.' });
        }
        res.status(200).json(ride);
    } catch (error) {
        console.error("Admin: Get Ride Error:", error);
        res.status(500).json({ error: 'Failed to fetch ride.' });
    }
};

// In src/controllers/adminController.js -> add this at the end

export const getDashboardStats = async (req, res) => {
  try {
    // Run multiple count queries in parallel for efficiency
    const [totalUsers, totalRides, pendingIdVerifications, pendingCarVerifications, premiumUsers] = await Promise.all([
      prisma.user.count(),
      prisma.ride.count(),
      prisma.user.count({ where: { idVerificationStatus: 'PENDING' } }),
      prisma.car.count({ where: { verificationStatus: 'PENDING' } }),
      prisma.user.count({ where: { isPremium: true } })
    ]);

    res.status(200).json({
      id: 'dashboard-stats', // React Admin needs an ID
      totalUsers,
      totalRides,
      pendingVerifications: pendingIdVerifications + pendingCarVerifications,
      premiumUsers,
    });
  } catch (error) {
    console.error("Admin: Get Dashboard Stats Error:", error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats.' });
  }
};

// Get list of all support chats
export const getSupportChats = async (req, res) => {
    const chats = await prisma.chat.findMany({
        where: { rideId: null }, // Support chats have no rideId
        include: {
            members: { include: { user: { select: { name: true, profileImage: true } } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
    });
    res.setHeader('Content-Range', `support-chats 0-${chats.length-1}/${chats.length}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
    res.json(chats);
};

// Get a single support chat with all its messages
export const getSupportChat = async (req, res) => {
    const { id } = req.params;
    const chat = await prisma.chat.findUnique({
        where: { id },
        include: {
            messages: { orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, name: true } } } },
            members: { include: { user: { select: { id: true, name: true } } } },
        },
    });
    res.json(chat);
};

// Send a message as an admin
export const sendAdminMessage = async (req, res) => {
    const { id: chatId } = req.params;
    const { content } = req.body;
    const adminId = req.user.userId;

    try {
        // 1. إنشاء الرسالة في قاعدة البيانات مع جلب بيانات الأدمن
        const message = await prisma.message.create({
            data: { content, chatId, userId: adminId },
            include: {
                user: { select: { id: true, name: true, profileImage: true } }
            }
        });

        // 2. جلب أعضاء المحادثة لتحديد المستخدم الذي سيستقبل الرسالة
        const chat = await prisma.chat.findUnique({
            where: { id: chatId },
            include: { members: true }
        });

        // 3. العثور على المستخدم (الذي ليس الأدمن)
        const userMember = chat.members.find(m => m.userId !== adminId);

        if (userMember) {
            // 4. جلب الاتصال الخاص بالمستخدم من القائمة
            const userSocketIds = userSockets.get(userMember.userId);

            // 5. إذا كان المستخدم متصلاً، أرسل له الرسالة لحظيًا
            if (userSocketIds && userSocketIds.size > 0) {
                console.log(`[Socket] Sending admin message to user ${userMember.userId}`);
                for (const socketId of userSocketIds) {
                    // إرسال حدث 'new_message' الذي يفهمه التطبيق بالفعل
                    io.to(socketId).emit('new_message', message);
                }
            }

            // 6. إرسال إشعار للمستخدم (للتنبيه إذا كان خارج التطبيق)
            await sendNotificationToUser(userMember.userId, {
                title: "New message from Support",
                message: content.length > 50 ? content.substring(0, 50) + '...' : content,
                type: 'NEW_SUPPORT_MESSAGE',
                userId: userMember.userId,
                relatedId: chatId,
            });
        }

        res.status(201).json(message);

    } catch (error) {
        console.error('Admin send message error:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
};

export const getUnreadCounts = async (req, res) => {
    try {
        const adminId = req.user.userId;

        const [
            newUsersCount,
            pendingUserVerifications,
            pendingCarVerifications,
            pendingReportsCount,
            unreadSupportChatsCount
        ] = await Promise.all([
            prisma.user.count({ where: { role: 'USER', createdAt: { gt: new Date(0) } } }), // Simplified for now
            prisma.user.count({ where: { idVerificationStatus: 'PENDING' } }),
            prisma.car.count({ where: { verificationStatus: 'PENDING' } }),
            prisma.report.count({ where: { status: 'PENDING' } }),
            prisma.notification.count({ where: { userId: adminId, type: 'NEW_SUPPORT_MESSAGE', isRead: false } })
        ]);
        
        const totalVerifications = pendingUserVerifications + pendingCarVerifications;

        const countsData = {
            id: 'unread-counts', // The ID is required by react-admin
            users: newUsersCount,
            verifications: totalVerifications,
            reports: pendingReportsCount,
            "support-chats": unreadSupportChatsCount
        };

        // --- THE CRUCIAL FIX ---
        // React Admin's useGetList hook expects an array of records.
        // We will send our single stats object inside an array.
        res.setHeader('Content-Range', `unread-counts 0-0/1`);
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
        res.status(200).json([countsData]); // Send as an array

    } catch (error) {
        console.error("Admin: Get Unread Counts Error:", error);
        res.status(500).json({ error: 'Failed to fetch unread counts.' });
    }
};

// Function to update the last visit timestamp for a resource
export const updateLastVisit = async (req, res) => {
    try {
        const adminId = req.user.userId;
        const { resource } = req.body;

        if (!resource) {
            return res.status(400).json({ error: 'Resource name is required.' });
        }

        // --- START: MODIFICATION ---
        // Store the result of the upsert operation
        const visitRecord = await prisma.adminLastVisit.upsert({
            where: { adminId_resource: { adminId, resource } },
            update: { lastVisitedAt: new Date() },
            create: { adminId, resource, lastVisitedAt: new Date() },
        });

        // Return the created/updated record as JSON, which React Admin expects
        res.status(200).json(visitRecord);
        // --- END: MODIFICATION ---

    } catch (error) {
        console.error("Admin: Update Last Visit Error:", error);
        res.status(500).json({ error: 'Failed to update last visit.' });
    }
};



export const getChartData = async (req, res) => {
    const { timeframe = 'weekly' } = req.query; // Default to weekly
    let groupBy;
    let dateFilter;

    const now = new Date();
    if (timeframe === 'daily') {
        groupBy = 'day';
        dateFilter = new Date(now.setDate(now.getDate() - 30)); // Last 30 days
    } else if (timeframe === 'monthly') {
        groupBy = 'month';
        dateFilter = new Date(now.setFullYear(now.getFullYear() - 1)); // Last 12 months
    } else { // weekly
        groupBy = 'week';
        dateFilter = new Date(now.setDate(now.getDate() - 90)); // Last ~3 months
    }

    try {
        // This is a raw query because Prisma's groupBy is complex for date truncation
        const result = await prisma.$queryRaw`
            SELECT
                DATE_TRUNC(${groupBy}, "createdAt")::DATE as date,
                COUNT(id)::int as count
            FROM "User"
            WHERE "createdAt" > ${dateFilter}
            GROUP BY date
            ORDER BY date ASC;
        `;

        // Format the data for the recharts library
        const formattedData = result.map(item => ({
            name: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            newUsers: item.count
        }));

        res.status(200).json(formattedData);
    } catch (error) {
        console.error("Admin: Get Chart Data Error:", error);
        res.status(500).json({ error: 'Failed to fetch chart data.' });
    }
};

// Gets all config values and formats them for a single-record react-admin view.
export const getConfig = async (req, res) => {
    try {
        const configs = await prisma.appConfig.findMany();
        // react-admin's <Edit> component expects a single object with an id.
        // We'll transform our array of key-value pairs into a single object.
        const configObject = configs.reduce((acc, curr) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {});
        
        // Add a static id for react-admin to work with.
        configObject.id = 'app-settings';

        res.status(200).json(configObject);
    } catch (error) {
        console.error("Admin: Get Config Error:", error);
        res.status(500).json({ error: 'Failed to fetch configuration.' });
    }
};

// Updates multiple config values from the react-admin form.
export const updateConfig = async (req, res) => {
    try {
        const { id, ...settings } = req.body; // Ignore the static 'id' field

        const updatePromises = Object.entries(settings).map(([key, value]) => {
            return prisma.appConfig.upsert({
                where: { key },
                update: { value: String(value) }, // Ensure value is a string
                create: { key, value: String(value) },
            });
        });

        await prisma.$transaction(updatePromises);
        
        res.status(200).json({ id: 'app-settings', ...settings });
    } catch (error) {        
        console.error("Admin: Update Config Error:", error);
        res.status(500).json({ error: 'Failed to update configuration.' });
    }
};

export const importUsers = async (req, res) => {
  // We expect the frontend to send an array of user objects
  const { users } = req.body;

  if (!users || !Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ error: 'User data must be a non-empty array.' });
  }

  let createdCount = 0;
  let updatedCount = 0;

  try {
    // Use a transaction to ensure all records are processed or none are (atomicity)
    await prisma.$transaction(async (tx) => {
      for (const user of users) {
        // Skip empty rows that might come from the CSV parser
        if (!user.email && !user.id) {
            continue;
        }

        // IMPORTANT SECURITY NOTE:
        // We will NOT import passwords from the CSV. 
        // If a new user is created, they must use the "Forgot Password" flow.
        // The 'password' field is deliberately removed here.
        const { password, ...userData } = user;

        const result = await tx.user.upsert({
          // Try to find an existing user by their email (must be unique)
          where: { email: userData.email },
          // If found, update their data
          update: {
            name: userData.name,
            phone: userData.phone,
            isVerified: userData.isVerified === 'true' || userData.isVerified === true, // Handle string from CSV
            isPremium: userData.isPremium === 'true' || userData.isPremium === true,
          },
          // If not found, create a new user
          create: {
            ...userData,
            // Ensure boolean values are correct
            isVerified: userData.isVerified === 'true' || userData.isVerified === true,
            isPremium: userData.isPremium === 'true' || userData.isPremium === true,
            // Set a placeholder password. The user must use "Forgot Password".
            password: 'imported_user_password_needs_reset', 
          },
        });
        
        // Check if the operation was a create or an update for counting
        if (result.createdAt.getTime() === result.updatedAt.getTime()) {
            createdCount++;
        } else {
            updatedCount++;
        }
      }
    });

    res.status(200).json({ 
        message: `Import successful. Created: ${createdCount}, Updated: ${updatedCount}.` 
    });

  } catch (error) {
    console.error("Admin: Import Users Error:", error);
    // If the error is due to a duplicate key or other data constraint
    if (error.code === 'P2002') {
        return res.status(409).json({ error: `A user with email "${error.meta.target}" already exists.` });
    }
    res.status(500).json({ error: 'Failed to import users.' });
  }
};