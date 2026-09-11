import { z } from 'zod';

export const DriverCommand=z.discriminatedUnion('op',[
  z.object({op:z.literal('pair')}).strict(),
  z.object({op:z.literal('status')}).strict(),
  z.object({op:z.literal('observe'),driverId:z.uuid(),endsAt:z.number().int().positive()}).strict(),
  z.object({op:z.literal('decide'),leaseId:z.string().max(100),decision:z.unknown(),usage:z.object({inputTokens:z.number().int().min(0).max(1000000),outputTokens:z.number().int().min(0).max(100000)}).strict()}).strict(),
  z.object({op:z.literal('failure'),leaseId:z.string().max(100),message:z.string().max(220)}).strict(),
]);
