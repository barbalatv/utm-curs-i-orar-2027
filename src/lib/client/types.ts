/** Client-side mirror of the API payload types (kept minimal on purpose). */
import type { DayName, Lesson, ScheduleMetadata, TimeSlot } from "@/lib/models";

export type { DayName, Lesson, TimeSlot };

export interface GroupsResponse {
  groups: { name: string; program: string; lessons: number }[];
  count: number;
  updated_at: string;
}

export interface ScheduleResponse {
  metadata: ScheduleMetadata;
  groups: string[];
  days: DayName[];
  time_slots: TimeSlot[];
  lessons: Lesson[];
  count: number;
  warnings: string[];
}

export interface StatusResponse {
  ok: boolean;
  has_schedule: boolean;
  schedule: {
    academic_year: string | null;
    semester: string | null;
    source_kind: "live" | "wayback" | "seed" | "manual";
    source_pdf_url: string;
    downloaded_at: string;
    parsed_at: string;
    groups: number;
    lessons: number;
    uncertain_lessons: number;
  } | null;
  source: {
    page_url: string;
    current_pdf_url: string | null;
    last_check_at: string | null;
    last_success_at: string | null;
    last_result: string;
    last_error: string | null;
    parity_note: string | null;
    refresh_interval_minutes: number;
  };
  server_time: string;
  timezone: string;
}
