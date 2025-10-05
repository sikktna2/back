import express from 'express';
import { authenticate } from '../auth.js';
import {
  sendFriendRequest,
  respondToFriendRequest,
  getFriends,
  searchUsers,
  unfriend,
  getFriendRequest,
} from '../controllers/friendsController.js';

const router = express.Router();

router.use(authenticate); // Apply authentication to all friend routes

router.get('/search', searchUsers);
router.post('/request', sendFriendRequest);
router.put('/request/:friendshipId/respond', respondToFriendRequest);
router.delete('/:friendId', unfriend);
router.get('/users/:userId/friends', getFriends); 
router.get('/request/:friendshipId', getFriendRequest);

export default router;