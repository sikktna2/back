// src/routes/adminRoutes.js

import express from 'express';
import { authenticate, requireAdmin } from '../auth.js';
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
    updateConfig,
importUsers,
} from '../controllers/adminController.js';

const router = express.Router();

// --- Add authenticate middleware to ALL admin routes for security ---

router.get('/dashboard-stats/:id', authenticate, requireAdmin, getDashboardStats);
router.get('/unread-counts/:id', authenticate, requireAdmin, getUnreadCounts);
router.post('/update-visit', authenticate, requireAdmin, updateLastVisit);
router.get('/dashboard-charts', getChartData);

// User routes
router.get('/users', authenticate, requireAdmin, getUsers);
router.post('/users/import', authenticate, requireAdmin, importUsers);
router.get('/users/:id', authenticate, requireAdmin, getUser);
router.put('/users/:id', authenticate, requireAdmin, updateUser);

// Verification routes
router.get('/verifications', authenticate, requireAdmin, getVerificationRequests);
router.put('/users/:id/verify', authenticate, requireAdmin, respondToUserVerification);
router.put('/cars/:id/verify', authenticate, requireAdmin, respondToCarVerification);

// Verified User routes
router.get('/verified-users', authenticate, requireAdmin, getVerifiedUsers);
router.get('/verified-users/:id', authenticate, requireAdmin, getVerifiedUser);

// Ride routes
router.get('/rides', authenticate, requireAdmin, getRides);
router.get('/rides/:id', authenticate, requireAdmin, getRide);

// Support Chat routes
router.get('/support-chats', authenticate, requireAdmin, getSupportChats);
router.get('/support-chats/:id', authenticate, requireAdmin, getSupportChat);
router.post('/support-chats/:id/messages', authenticate, requireAdmin, sendAdminMessage);

// [MODIFICATION] The GET and PUT routes now accept an ":id" parameter to match react-admin's requests.
router.get('/config/:id', authenticate, requireAdmin, getConfig);
router.put('/config/:id', authenticate, requireAdmin, updateConfig);

// Report routes (assuming you will add these)
 //router.get('/reports', authenticate, getReports);
// router.put('/reports/:id', authenticate, updateReportStatus);


export default router;