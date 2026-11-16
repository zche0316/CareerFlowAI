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

- **Have a resume? Import it instead of typing** (a link at the top of the right-hand panel). Upload
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
11. Type **finish this experience**, then **next project** (or just start describing it):
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
14. Answer the matching preferences the Profile Builder now asks about, one at a time:
    > SQL, Python, pandas, PostgreSQL, Power BI, Tableau and Excel.

    > Sydney.

    > Hybrid.

    > Full-time graduate roles.
15. Type **that's all** (or press **Finish and review** under the message box). If any profile
    field is still empty, the Profile Builder lists it once and asks about it; say **skip**, or
    finish again to review the draft as it is.

Before approving, open **Edit profile details manually** and check the dates, organisations and
skills (SQL, Python, pandas, PostgreSQL, Power BI, Tableau, Excel). Nothing Coach drafted is used
until you approve it. With about three months of internship, Sam's rank is Rookie.

To try the resume path instead, copy the same facts into a text file and upload it under
**Have a resume? Import it instead of typing**.

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

On **Interview practice** the panel follows the usual graduate interview loop, one stage per
question: motivation, behavioural (a real example in STAR form), technical, then a scenario or a
skill gap, and sometimes a closing question for you to ask. Each stage has a few follow-ups; the
tabs above the question show which stages are covered. A run from before the stages existed shows
plain "Question" tabs; while nothing is answered, **Re-plan the interview** makes a staged set.

**Your turn** offers two ways to answer, one at a time:

- **Live call** (live mode, when voice is set up): the panel asks out loud and follows up, and you
  talk. The arena shows the panel's latest line and yours as subtitles; the full transcript is
  folded under the call controls. **End and score my answers** scores each answer like a typed
  one. Follow-ups may ask about items on the resume you approved for this role.
- **One question at a time**: type the answer, **Record your answer** (transcribed, then the
  audio is discarded) or **Speak your answer** with the browser's speech service, and get a
  verdict after each. Asking "what do you mean?" or "can you repeat that?" gets a reply without a
  score; "skip" moves on.

Then finish (or end early). The panel scores the answers and writes feedback.

Check: the notice changes to "Practice finished. Your feedback and next steps are below."

### Sample live call (read aloud)

To rehearse a live call without making up answers, let the computer speak Sam Rivera's replies
into the call. The questions vary between runs, but each belongs to a stage, so pick the reply for
the stage on the active tab.

How to play a reply:

- **macOS, any app:** System Settings → Accessibility → Spoken Content → turn on **Speak
  selection**. Select a reply below and press Option+Esc. Press it again to stop.
- **macOS, Terminal:** `say -v Samantha -r 170 "paste the reply here"`.
- Use the computer's speakers, not headphones, so the microphone hears the voice. Wait for **Your
  turn to speak** before playing, and play one reply per turn. If the panel does not react, turn
  the volume up or read the reply from another device.

Some first answers leave a part out on purpose, so the panel has something to follow up on.

1. **Motivation** (why this role and company)
   > I want to start my career as an analyst, where careful data work answers a real question for
   > someone. In my internship at Harbourline Logistics I automated a weekly report with SQL and
   > Python, and the part I enjoyed most was checking the numbers and explaining what they meant
   > to the operations team. This role would let me do that on harder questions, with experienced
   > people reviewing my work, which is how I want to learn.

   If asked why this company in particular:

   > From the job description, analysts here own a question from the raw data to the final
   > explanation for the client. I want that end-to-end responsibility, not only building
   > dashboards, and a graduate program gives me structure while I learn it.

2. **Behavioural** (a real situation, STAR)
   > In my data visualisation unit, our team of four built a Sydney bike share demand dashboard.
   > I owned the data pipeline. When we first charted the data, weekend demand looked far too
   > high, so I traced it back to the raw trip files and fixed the problem before the team built
   > the final charts.

   If asked what exactly you did:

   > I found that about eight percent of rows were duplicates. I wrote a de-duplication step keyed
   > on trip ID and timestamp, and I added row-count checks after every load, so a bad file would
   > show up straight away.

   If asked about the result:

   > Weekend demand dropped to realistic levels, the eight percent was measured from the raw
   > files, our tutor accepted the dashboard, and the team received a distinction.

3. **Technical** (hands-on depth, for example cleaning data with SQL and Python)
   > First I would profile the data: row counts, missing values, duplicates on the key columns,
   > and values outside a sensible range. In SQL I would build a view that joins the tables and
   > keeps the raw data untouched. In Python with pandas I would apply the cleaning rules and log
   > how many rows each rule changed. Then I would reconcile totals against the source system
   > before anyone uses the results.

   If asked how you know your checks worked:

   > In my internship I compared my automated late-delivery report with four past weeks of manual
   > reports. Where they differed, I found out why before switching the team over.

4. **Scenario** (a realistic task, for example whether a regulatory change affected prices)
   > I would first pin down the change, the date it took effect and the prices it could affect.
   > Then I would collect prices before and after the change, for the affected market and for a
   > comparable market that was not affected, and check that both moved together before the
   > change. A difference-in-differences regression would estimate the effect. I would report it
   > as a range, with the main limitations: other events at the same time, data quality, and
   > whether the comparison market really is comparable.

   If asked how you would explain the limits to a client:

   > I would lead with the answer and how confident we are, then show one chart of the two
   > markets over time, and list what could change the conclusion in plain language.

5. **Gap** (a required skill the profile does not show yet)
   > I have not used that at work yet. The closest I have done is regression modelling in my
   > statistics major and the analysis in my internship. My plan is to work through a short
   > course in the first weeks, apply it to a small public dataset, and ask a senior analyst to
   > review my first piece of work.

6. **Closing** (questions for the panel)
   > Thank you. What does a typical first project look like for a graduate analyst, and how is
   > that work reviewed? And how do graduates get feedback during the first six months?

Also try a non-answer once: "Sorry, could you repeat the question?" The panel should repeat the
question rather than move on.

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
