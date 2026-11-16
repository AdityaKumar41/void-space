# Learning analytics

The console's **Learning analytics** page is available to users with the existing
`learning:manage` permission (TenantAdmin, Creator, Assessor and SuperAdmin).
The API applies the same permission check and scopes every query to the active
tenant.

## Metrics

- Quiz attempts, average score, pass rate and issued credentials come from
  submitted `LessonAttempt` records; saved answers are not counted as assessments.
- Learning time records foreground lesson time. The lesson player sends a
  heartbeat every 15 seconds while the document is visible. The server credits
  only the time between recent heartbeats, up to 45 seconds, and ignores longer
  gaps. This avoids counting a closed or background tab as study time; delayed
  heartbeats can undercount actual time.
- Skill development is represented by the latest assessment stage per learner
  and lesson. It uses the existing Awareness, Practice, Apply and Mastery stages,
  not an independently validated skill taxonomy.
- Lesson-position percentages use the same saved step and assessment state shown
  by the lesson player. They are reading positions, not proof of lesson mastery.
- The dashboard plots daily average quiz scores and attempt volume for the last
  30 days. Student reports show tenant-scoped lesson positions, time, assessment
  history, pass rates and issued credentials.
- AI insights and recommendations are generated only on request from database-backed,
  tenant-scoped workspace summaries, lesson-level aggregate scores/progress, and daily
  performance trends. Learner names and individual reports are not sent. Configure
  `OPENAI_API_KEY` on the API server to enable this action; the key never reaches the
  browser. If OpenAI is not configured or cannot return valid insights, the API reports
  an explicit error rather than showing generated-looking fallback content.
  Verify the live path with `pnpm ai:check:insights`.

Study time is stored on the tenant-scoped `lesson_progress` record. The latest
heartbeat timestamp is used only to calculate a bounded interval; no per-second
location or activity stream is stored.
