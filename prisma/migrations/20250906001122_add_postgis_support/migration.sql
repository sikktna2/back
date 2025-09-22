-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "destinationGeom" geography(Point, 4326),
ADD COLUMN     "originGeom" geography(Point, 4326);
