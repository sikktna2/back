// src/io.js
import http from 'http';
import { Server } from 'socket.io';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

export const app = express();
export const server = http.createServer(app);
export const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});