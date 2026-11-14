# Walkthrough from a new account

A route through CareerFlow from sign-up to an application you send yourself. Use it to try the
product end to end, or to check a release by hand. Each step says what to do, what you should
see, and what to note if it looks wrong.

Run the app with `npm run start:local` and open http://localhost:8787. In live mode (OpenAI key
set), model calls cost money: every start button shows an estimate first, and the Battle log of a
run shows what it spent. Without a key the app runs in demo mode with fictional jobs and
rule-based feedback, and the top bar shows **Demo mode**.

## 1. Create an account

1. On the sign-in page choose **New here? Create an account**, enter a name, email and
   password, then **Create workspace**.
2. You land on **Home** with the hero "Start with your profile." and a five-step route:
   Profile → Find roles → Tailor → Practice → Apply.

Top bar: Home, Quests, Jobs, Scout, World and **More** (Coach, Party, Season event, Decision
inbox, Applications, Activity). Your avatar on the right opens Character, My profile, My
documents and Sign out.

## 2. Build your profile

Press **Build my profile**. Two ways in, and you can mix them:

- **Start from your resume** (open at the top of the right-hand panel on a new account). Upload
  a PDF, text file or photo of your resume. CareerFlow drafts work, project and education
  records from it; nothing is saved yet.
- **Chat with Coach** on the left. Answer its questions about study, work and projects; the
  panel on the right fills in as you go. Type, or press **Record your answer** (live mode): the
  recording becomes text in the message box for you to edit before sending. Small talk and
  questions about the builder get a reply, and the pending question stays open.

Then open **Edit profile details manually** to fix anything, especially the start and end months
of each job: they set your experience rank.

### Sample conversation (text only)

To try the chat path without your own details, paste these replies one at a time. They describe a
fictional graduate, Sam Rivera, and follow the order Coach asks in: goal, name, education, then
each experience (dates, organisation, overview, one example, its result). Coach's wording varies
in live mode; answer whatever it asks with the matching reply below, and use **Skip this
question** for anything not covered. Together they give enough for a one-page graduate resume:
education, an internship, a university project and a skill list.

1. **Goal**
   > I want a graduate data analyst role in Sydney, building reports and dashboards with SQL and
   > Python. Full-time, hybrid is fine, starting February 2027.
2. **Name**
   > Sam Rivera
3. **Education**
   > Bachelor of Science in Statistics at the University of Sydney, from March 2023 to November
   > 2026. Relevant units: database systems, regression modelling, data visualisation.
4. **First experience**
   > I was a data analyst intern at Harbourline Logistics (fictional) from December 2025 to
   > February 2026.
5. **Overview of the internship**
   > I wrote SQL queries against the shipment database, cleaned weekly delivery data in Python
   > with pandas, and maintained three Power BI dashboards for the operations team. I worked with
   > two analysts and reported to the operations manager.
6. **One example (situation)**
   > The weekly late-delivery report was built by hand in Excel and took about four hours every
   > Monday, and the numbers often disagreed with the warehouse system.
7. **Your task**
   > My goal was to automate the report so it matched the warehouse data and was ready before the
   > Monday meeting.
8. **What you did**
   > I wrote one SQL view that joined shipments to delivery scans, a pandas script that flagged
   > late deliveries by region, and connected the output to a Power BI page with a refresh
   > schedule. I checked it against four past weeks of manual reports.
9. **Result**
   > The report now refreshes automatically on Monday morning and the operations team uses it in
   > their weekly meeting.
10. **Measurable change** (Coach asks this when the result has no numbers)
    > Preparation went from about four hours to about fifteen minutes of checking. That is my own
    > estimate, not a measured figure, and it was my own work.
11. **Finish this experience**, then add another when Coach offers:
    > A university project: Sydney Bike Share Demand Dashboard, a team project in my data
    > visualisation unit, August to October 2026.
12. **Overview of the project**
    > Team of four. I owned the data pipeline: I pulled two years of public bike-share trip data,
    > cleaned it in Python, stored it in PostgreSQL and built the station-level demand charts in
    > Tableau.
13. **Example, task, action, result** (answer each as Coach asks, or skip)
    > Situation: the raw trip files had about 8% duplicate rows that inflated weekend demand.
    > Task: I was responsible for clean data before the team built charts.
    > Action: I wrote a de-duplication step keyed on trip ID and timestamp and added row-count
    > checks after each load.
    > Result: weekend demand figures dropped to realistic levels and our tutor accepted the
    > dashboard; we received a distinction. The 8% figure was measured from the raw files.
14. **Finish this experience**, then **Finish interview and review**.

Before approving, open **Edit profile details manually** and check the dates, organisations and
skills (SQL, Python, pandas, PostgreSQL, Power BI, Tableau, Excel). Nothing Coach drafted is used
until you approve it. With about three months of internship, Sam's rank is Rookie.

To try the resume path instead, copy the same facts into a text file and upload it under
**Start from your resume**.

Press **Approve & save profile**. Only approved facts are used anywhere else in the app.

Check: the approval notice appears, Home's route moves to "Find roles", and the avatar menu's
**Character** page now shows your rank.

## 3. Look at your Character

Avatar → **Character**.

- **Experience rank** (Rookie, Apprentice, Adventurer, Veteran, Legend) comes from the years in
  your approved profile, or from your work dates when no years are stated. Courses and personal
  projects do not count. After a job search it also says how many ranked roles ask for more years
  than you have.
- **Level and XP** measure what you have done in CareerFlow (approved facts, resumes, practice).
- **Capability levels** rate each skill from approved evidence. **Add evidence** lets you link
  public sources (GitHub and similar) for review before anything is added.

## 4. See what the market asks for (optional)

- **Coach** (Home card or More → Coach) gives strengths, gaps and next steps for your approved
  profile, citing your facts and O\*NET or ESCO occupation descriptions. **Ask Coach** on that
  page answers your own questions ("Which roles fit me?", "What should I learn next?"); each
  answer lists the facts and sources it used. Telling it news about yourself points you to the
  Profile Builder; the Coach never edits your profile.
- **World** shows what each region asks for and lets you change where the next search runs.

## 5. Find roles

**Jobs** → describe the role you want and where → **Send the party out**. The run takes a minute
or two in live mode; you can leave the page.

You should see ranked roles, each with its requirements grouped by how much of your approved
evidence covers them. Pick one with **Select this opportunity**, or **Save to my quests for later** to come
back later. A job link of your own can be read with **Have a job in mind?**.

## 6. Tailor the resume

After you choose a role the resume team drafts a resume for it.

- If the role needs skills your profile does not show, you first get **one question**: say where
  you used them, or skip. Answers become new facts only after you approve them.
- On **Review your resume.** check the highlighted changes, edit wording, and confirm. Approving
  saves that exact version.

Practice does not wait for the resume: from the Quest log you can start interview practice for a
role at any time.

## 7. Practise the interview

On **Interview practice** you get questions for the role. Asking "what do you mean?" or "can you
repeat that?" gets a reply from the panel without a score; "skip" moves on. For each question
you can:

- type the answer;
- **Record your answer** (live mode): the recording is transcribed, the text appears for you to
  edit, and the audio is discarded;
- **Speak your answer** with the browser's own speech service, where supported;
- **Read aloud** a question.

Submit answers, then finish (or end early). The panel scores them and writes feedback.

Check: the notice changes to "Practice finished. Your feedback and next steps are below."

## 8. Apply

The finished run shows **What to do next**:

1. Download the tailored resume (DOCX or PDF).
2. Open the listing and apply on the employer's site. CareerFlow never applies for you.
3. In **Quests**, set the role's status to **Applied**.
4. Practise again with a new set of questions, if you like.

## 9. Keep going

- **Quests** keeps every role, its resume versions and practice runs. **Tailor again** after you
  improve your profile.
- **Scout** runs scheduled searches and puts new roles above your minimum match on your board.
- Each run's **Battle log** shows what every agent did and what it cost; **Save points** shows
  the checkpoints of a run.

## What to note while you try it

For each issue, write the page, what you did, what you expected and what happened. Screenshots
help. Things worth watching: wording that feels vague or robotic, steps where it is unclear what
to press next, and anything shown that is not from your approved profile.
