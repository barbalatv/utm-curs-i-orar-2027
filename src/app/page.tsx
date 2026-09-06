import { ScheduleApp } from "@/components/ScheduleApp";
import { DEFAULT_COURSE_YEAR, SUPPORTED_COURSES } from "@/lib/courses";

export const dynamic = "force-dynamic";

/** The course switcher is rendered from server-side configuration, so it needs no extra fetch. */
export default function HomePage() {
  const courses = SUPPORTED_COURSES.map((course) => ({
    course_year: course.year,
    label: course.label,
    roman: course.roman,
  }));
  return <ScheduleApp courses={courses} defaultCourse={DEFAULT_COURSE_YEAR} />;
}
