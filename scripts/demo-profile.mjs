// A fictional graduate used for local demos. The person, university, employers and contact
// details are invented; the shape and level of detail follow typical Australian graduate and
// student resumes (a degree with coursework and a WAM, one internship, a part-time job, course
// and personal projects, a club role and volunteering). Every result is stated modestly and can be
// traced to a line below, so the resume team has real evidence to select from and real gaps to
// report.

export const demoProfile = {
  name: 'Jordan Ellis',
  careerStage: 'graduate',
  goals:
    'Start a graduate data analyst role in Sydney where I build reporting and dashboards from SQL and Python, then grow into analytics engineering.',
  skills: [
    'Python',
    'pandas',
    'SQL',
    'PostgreSQL',
    'Power BI',
    'Tableau',
    'Excel',
    'R',
    'Git',
    'Statistics',
    'Data cleaning',
    'Data visualisation',
    'Stakeholder communication',
  ],
  interests: ['data analysis', 'business intelligence', 'analytics engineering'],
  education:
    'Bachelor of Science (Data Science), Harbour City University (fictional), 2022–2025, WAM 76 (Distinction).',
  educations: [
    {
      id: 'edu-bsc',
      title: 'Bachelor of Science (Data Science)',
      major: 'Data Science, minor in Statistics',
      organisation: 'Harbour City University (fictional)',
      location: 'Sydney NSW',
      startMonth: '2022-02',
      endMonth: '2025-11',
      current: false,
      relevantCoursework: [
        'Database Systems',
        'Data Wrangling',
        'Statistical Modelling',
        'Machine Learning',
        'Data Visualisation',
        'Data Science Capstone',
      ],
      details: [
        'WAM 76 (Distinction).',
        "Dean's List for the Faculty of Science in 2024.",
        'Capstone: built a reporting dashboard with a team of four for a community partner.',
      ],
      technologies: [],
      url: '',
    },
  ],
  workExperiences: [
    {
      id: 'work-intern',
      title: 'Data Analyst Intern',
      experienceType: 'work',
      organisation: 'Northwind Logistics (fictional)',
      location: 'Sydney NSW',
      startMonth: '2024-12',
      endMonth: '2025-02',
      current: false,
      overview: 'Twelve-week summer internship in the operations reporting team.',
      details: [
        'Wrote SQL queries in PostgreSQL to combine delivery and depot data for a weekly on-time delivery report.',
        'Rebuilt the report in Power BI so managers could filter by depot and week instead of reading a spreadsheet export.',
        'Cleaned about 40,000 delivery records in Python (pandas), documenting each rule for missing and duplicate rows.',
        'Presented the dashboard and its data checks to the operations manager and two depot leads.',
        'The team kept using the dashboard after the internship; I did not measure time saved.',
      ],
      starStory: {
        situation:
          'The weekly on-time delivery report was a manual spreadsheet export that took a team member most of Monday morning.',
        task: 'Make a repeatable report that managers could filter by depot and week.',
        action:
          'I wrote the SQL to join delivery and depot tables, cleaned duplicate and missing records in pandas, and built a Power BI dashboard with a short page explaining each data check.',
        result:
          'The operations team adopted the dashboard for its weekly meeting. I did not measure the time saved.',
      },
      technologies: ['SQL', 'PostgreSQL', 'Python', 'pandas', 'Power BI'],
      url: '',
    },
    {
      id: 'work-retail',
      title: 'Customer Service Assistant (part-time)',
      experienceType: 'work',
      organisation: 'Greenleaf Grocers (fictional)',
      location: 'Sydney NSW',
      startMonth: '2021-06',
      endMonth: '2024-11',
      current: false,
      details: [
        'Served customers at the registers and service desk around 15 hours a week during study.',
        'Handled refunds and complaints, escalating to the store manager when policy required.',
        'Trained four new casual staff on the register and stock procedures.',
      ],
      technologies: [],
      url: '',
    },
  ],
  projects: [
    {
      id: 'proj-capstone',
      title: 'Food Bank Volunteer Rostering Dashboard (capstone)',
      experienceType: 'course',
      organisation: 'Harbour City University (fictional)',
      location: 'Sydney NSW',
      startMonth: '2025-03',
      endMonth: '2025-10',
      current: false,
      overview:
        'Two-semester capstone with a fictional community food bank as the client, in a team of four.',
      details: [
        'Gathered requirements with the client coordinator in three meetings and wrote them up as user stories.',
        'Designed the PostgreSQL schema for volunteers, shifts and attendance.',
        'Built the Tableau dashboard showing unfilled shifts by week; teammates built the data entry form.',
        'The client used the dashboard in a two-week trial; the team received a High Distinction.',
      ],
      technologies: ['PostgreSQL', 'SQL', 'Tableau', 'Python'],
      url: '',
    },
    {
      id: 'proj-transport',
      title: 'Public Transport Delay Analysis (personal project)',
      experienceType: 'personal',
      organisation: '',
      location: '',
      startMonth: '2024-06',
      endMonth: '2024-08',
      current: false,
      details: [
        'Analysed a public open-data sample of train arrival times with Python (pandas) and R.',
        'Fitted a simple regression of delay against time of day and weather; explained why it only explained part of the variation.',
        'Published the notebook and a short write-up with charts on GitHub.',
      ],
      technologies: ['Python', 'pandas', 'R', 'Git'],
      url: '',
    },
    {
      id: 'proj-churn',
      title: 'Customer Churn Prediction (Machine Learning course)',
      experienceType: 'course',
      organisation: 'Harbour City University (fictional)',
      location: '',
      startMonth: '2024-08',
      endMonth: '2024-10',
      current: false,
      details: [
        'Trained logistic regression and random forest models on a public telecom churn dataset with scikit-learn.',
        'Compared models with cross-validation and reported recall for the churn class, not only accuracy.',
      ],
      technologies: ['Python', 'scikit-learn', 'pandas'],
      url: '',
    },
    {
      id: 'club-treasurer',
      title: 'Treasurer, Data Science Society',
      experienceType: 'club',
      organisation: 'Harbour City University (fictional)',
      location: '',
      startMonth: '2024-02',
      endMonth: '2024-12',
      current: false,
      details: [
        'Kept the society budget in Excel and reported spending to the committee each month.',
        'Co-organised a beginner SQL workshop attended by about 30 students.',
      ],
      technologies: ['Excel'],
      url: '',
    },
    {
      id: 'vol-tutor',
      title: 'Volunteer Maths Tutor',
      experienceType: 'volunteer',
      organisation: 'Westside Community Library (fictional)',
      location: 'Sydney NSW',
      startMonth: '2023-03',
      endMonth: '2024-06',
      current: false,
      details: ['Tutored high school students in maths for two hours each week.'],
      technologies: [],
      url: '',
    },
  ],
  contact: {
    email: '',
    phone: '0400 000 000',
    city: 'Sydney NSW',
    linkedin: '',
    portfolio: '',
    workRights: 'Australian citizen (fictional demo candidate)',
  },
  experience:
    'Data Analyst Intern at Northwind Logistics (fictional), summer 2024–25; part-time customer service during study; capstone and personal data projects.',
  experienceYears: 0,
  location: 'Sydney',
  employmentType: 'Full-time',
  workArrangement: 'Hybrid',
  companySize: '',
  industry: '',
  startDate: null,
  endDate: null,
  salaryMin: null,
  salaryMax: null,
  currency: '',
  sharing: { coach: true, matching: true, resume: true, interview: true },
};

// Confirmed career memories: extra stories the resume team and interview coach can draw on.
export const demoMemories = [
  {
    kind: 'STAR',
    title: 'Handled a disagreement about chart choice in the capstone',
    star: {
      situation:
        'In the capstone, a teammate and I disagreed about whether the client needed a weekly table or a chart of unfilled shifts.',
      task: 'Agree on one view before the client demo.',
      action:
        'I made a quick version of both, and we asked the client coordinator to try each one with last month’s data.',
      result: 'The coordinator chose the chart with the table underneath; we shipped that.',
    },
    source: {
      kind: 'user',
      quote: 'Entered for the local demo account (fictional).',
    },
    recordId: 'proj-capstone',
  },
  {
    kind: 'STAR',
    title: 'Found a duplicate-record error before the internship report went out',
    star: {
      situation:
        'During the internship, the first draft of the on-time report showed one depot at 104% on-time.',
      task: 'Find out why before the report reached managers.',
      action:
        'I traced it to deliveries re-scanned at a second depot, wrote a rule to keep the final scan only, and added a check that flags any rate above 100%.',
      result: 'The corrected report went out on time; the check stayed in the dashboard.',
    },
    source: {
      kind: 'user',
      quote: 'Entered for the local demo account (fictional).',
    },
    recordId: 'work-intern',
  },
  {
    kind: 'NOTE',
    title: 'Learning dbt',
    text: 'Working through the free dbt Fundamentals course to move towards analytics engineering. Not yet used at work.',
    source: {
      kind: 'user',
      quote: 'Entered for the local demo account (fictional).',
    },
  },
];
