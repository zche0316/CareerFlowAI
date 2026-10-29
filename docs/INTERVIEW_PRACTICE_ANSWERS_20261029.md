# Technical Services Engineer interview practice

These are local practice answers for the current test profile, not new qualifications or application submissions. The course-project example uses the owner's supplied facts. Other existing profile entries remain explicitly fictional test data. Hypothetical approaches below must not be presented as completed work.

## Question 1

Describe a specific situation where you diagnosed and resolved a complex performance issue in a production database environment. Include the steps you took from the application tier through the database down to storage, the tools you used, and the measurable outcome of your intervention.

### Prepared answer

I have not yet diagnosed a production MongoDB performance incident, so I would not claim a production result. My closest relevant example is a DATA1002 course project using the Wisconsin Breast Cancer Dataset. I set up the multi-file Python structure, handled CSV input and missing-value standardisation, strengthened error handling, and wrote more than 20 unit tests. The reported correctness was limited to the test dataset; we did not measure production database latency or throughput.

For a production incident, my approach would be to establish the affected requests, baseline latency and recent changes first. I would trace the application request path and connection behaviour, inspect slow queries and execution plans, and compare database CPU, memory and storage I/O to identify the bottleneck. On Atlas I would check available Query Profiler and Performance Advisor information. I would test a targeted query or index change in a representative non-production environment, agree a rollback plan, and compare the same workload before and after. I would report measured latency, throughput and error-rate changes rather than invent a percentage improvement.

## Question 2

Explain your approach to integrating a partner's application with MongoDB Atlas. Discuss how you would use APIs, address security considerations such as LDAP/Active Directory, choose appropriate data models, and ensure the solution meets both technical and partner-specific requirements.

### Prepared answer

I have not delivered a production Atlas integration. I would start with the partner's user journeys, access patterns, data sensitivity, integration contracts and acceptance criteria. I would separate the application's data-access interface from Atlas administration: the backend would use an appropriate supported driver, while management automation would use the relevant administration interface and separately scoped credentials.

For security, I would agree least-privilege access, encrypted connections, secret handling and network restrictions with the partner's security team. If LDAP or Active Directory were required, I would verify the currently supported authentication path for their deployment rather than assume direct compatibility. MongoDB documents LDAP deprecation from version 8.0, so I would assess supported alternatives with the team before choosing an identity design.

I would model documents around actual read and write patterns, evaluate embedding versus references, and validate indexes against representative queries. I would then test successful and invalid requests, permissions, failure handling and operational monitoring, and obtain partner acceptance against the agreed criteria. My existing Python input-validation and unit-testing experience is transferable, but I would need supervision for unfamiliar Atlas administration tasks.

## Question 3

Provide an example of how you have leveraged Git in a collaborative software product team to manage code changes, handle branching and merging, and support reliable release processes. Highlight any challenges you faced and how you overcame them.

### Prepared answer

My confirmed example is a university team project, rather than a commercial release process. We used Git and GitHub for collaboration, and I set up the project's multi-file Python structure and contributed more than 20 unit tests. That gave me experience organising changes across files and coordinating work with teammates. The information in my profile does not establish a particular merge conflict or formal release policy, so I would not invent one.

In a product team, I would propose small feature branches and focused commits, with a pull request explaining the change and its tests. Before merging, I would update the branch, resolve overlapping edits with the relevant teammate, and run the agreed checks again. I would require review and passing tests before treating a version as ready for release, and record the tested revision and rollback steps. A risk I would watch for is simultaneous edits to shared parsing code; I would reduce that risk through clear ownership, small changes and tests of the affected behaviour. To strengthen this answer further, I would bring an actual reviewed pull request or merge example from my own work.

## Technical references

The diagnostic tools are documented in [MongoDB Atlas Performance Advisor](https://www.mongodb.com/docs/atlas/performance-advisor/). Authentication support and LDAP deprecation are documented in [Atlas LDAP authentication](https://www.mongodb.com/docs/atlas/security-ldaps/). These references support the proposed technical approaches, not a claim of personal production experience.
