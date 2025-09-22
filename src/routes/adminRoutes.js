// src/routes/adminRoutes.js

import express from 'express';
import { authenticate } from '../auth.js';
import { 
    getUsers, 
    getUser,
    getVerificationRequests,
    respondToUserVerification,
    respondToCarVerification,
    getVerifiedUsers,
    getVerifiedUser,
    getRides,
    getRide,
    getDashboardStats,
    getSupportChats,
    getSupportChat,
    sendAdminMessage,
    getUnreadCounts,
    updateLastVisit,
    updateUser,
    getChartData,
    getConfig,
    updateConfig
} from '../controllers/adminController.js';

const router = express.Router();

// --- Add authenticate middleware to ALL admin routes for security ---

router.get('/dashboard-stats', authenticate, getDashboardStats);
router.get('/unread-counts', authenticate, getUnreadCounts);
router.post('/update-visit', authenticate, updateLastVisit);
router.get('/dashboard-charts', getChartData);

// User routes
router.get('/users', authenticate, getUsers);
router.get('/users/:id', authenticate, getUser);
router.put('/users/:id', authenticate, updateUser);

// Verification routes
router.get('/verifications', authenticate, getVerificationRequests);
router.put('/users/:id/verify', authenticate, respondToUserVerification);
router.put('/cars/:id/verify', authenticate, respondToCarVerification);

// Verified User routes
router.get('/verified-users', authenticate, getVerifiedUsers);
router.get('/verified-users/:id', authenticate, getVerifiedUser);

// Ride routes
router.get('/rides', authenticate, getRides);
router.get('/rides/:id', authenticate, getRide);

// Support Chat routes
router.get('/support-chats', authenticate, getSupportChats);
router.get('/support-chats/:id', authenticate, getSupportChat);
router.post('/support-chats/:id/messages', authenticate, sendAdminMessage);

// [MODIFICATION] The GET and PUT routes now accept an ":id" parameter to match react-admin's requests.
router.get('/config/:id', authenticate, getConfig);
router.put('/config/:id', authenticate, updateConfig);

// Report routes (assuming you will add these)
 //router.get('/reports', authenticate, getReports);
// router.put('/reports/:id', authenticate, updateReportStatus);


export default router;