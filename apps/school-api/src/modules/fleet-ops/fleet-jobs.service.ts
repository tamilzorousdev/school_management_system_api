import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { AppException } from '@app/common';
import { TelematicsClient } from '../fleet/telematics.client';
import { TransportTrip } from '../tracking/entities/transport-trip.entity';
import { Vehicle } from '../transport/entities/vehicle.entity';

const GPS_BATCH = 25;
const GPS_LOOKBACK_DAYS = 14;

@Injectable()
export class FleetJobsService {
  private readonly logger = new Logger('FleetJobs');
  private busy = false;

  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    @InjectRepository(TransportTrip) private readonly trips: Repository<TransportTrip>,
    private readonly telematics: TelematicsClient,
  ) {}

  @Cron('30 6 * * *', { name: 'bus-odometer', timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' })
  async refreshOdometers(): Promise<number> {
    const buses = await this.vehicles.find({ where: { device_id: Not(IsNull()), status: 'active' } });
    let updated = 0;
    for (const bus of buses) {
      try {
        const health = await this.telematics.get<{ odometer_km?: number | null }>(`/devices/${bus.device_id}/health`);
        const km = Number(health?.odometer_km);
        if (!health || health.odometer_km == null || !Number.isFinite(km) || km <= 0) continue;
        await this.vehicles.update(bus.id, {
          tracker_odometer_km: Math.round(km * 10) / 10,
          tracker_odometer_at: new Date(),
        });
        updated++;
      } catch (error) {
        if (error instanceof AppException && error.getStatus() === 503) break;
      }
    }
    if (updated) this.logger.log(`Odometer read for ${updated} buses`);
    return updated;
  }

  @Interval('trip-gps-km', 300000)
  async fillTripKm(): Promise<number> {
    if (this.busy) return 0;
    this.busy = true;
    try {
      const trips = await this.trips
        .createQueryBuilder('t')
        .where("t.status = 'ended'")
        .andWhere('t.telematics_trip_id IS NOT NULL')
        .andWhere('t.gps_checked_at IS NULL')
        .andWhere(`t.ended_at > now() - interval '${GPS_LOOKBACK_DAYS} days'`)
        .orderBy('t.ended_at', 'ASC')
        .limit(GPS_BATCH)
        .getMany();
      let filled = 0;
      for (const trip of trips) {
        try {
          const playback = await this.telematics.get<{ distance_km?: number }>(
            `/trips/${trip.telematics_trip_id}/playback`,
            { max_points: 2 },
          );
          const km = Number(playback?.distance_km);
          await this.trips.update(trip.id, {
            gps_km: Number.isFinite(km) && km >= 0 ? String(Math.round(km * 10) / 10) : null,
            gps_checked_at: new Date(),
          });
          filled++;
        } catch (error) {
          if (error instanceof AppException && error.getStatus() === 503) break;
          await this.trips.update(trip.id, { gps_checked_at: new Date() });
        }
      }
      return filled;
    } finally {
      this.busy = false;
    }
  }
}
