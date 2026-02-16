Give me an agentic `Design.md` defining a service that allows automating job applications. The document should help LLM's implement the entire working product. The tech stack for the app is as follows.

1. Svelte-KIT (For serving the web app and performing backend tasks)
2. Copilot KIT (For interacting with an LLM and running browser tasks)
3. agent-browser (For automating a job application on a browser)
4. Skeleton UI (For UI elements) 

Note that this entire platform is for one user only.

The svelte frontent APP features three tabs 

1. Roadmap
This page is a rough kanban board with swim lanes for applications created where each application will then have its own page containing the resume used, the form details filled etc. I should be able to move each application among swim lanes. This page default comes with four swim lanes a. Backlog b. Applied, c. Rejected d. Action Required out of which Backlog, Applied and Rejected cannot be removed. Initially applications start in Applied, and based on events can be moved to other user customizable swim lanes.

2. Profiles
Allows the user to customize job profiles by conversing with an LLM. This should allow the LLM to understand the user's skillset in preperation for filling out a job application form.

3. Settings
This page has subtabs

3.1 Email connections
Allows the user to connect to an email service should they want to auto-manage moving applications between swim lanes

3.2 Job postings boards
Allows the user to select and schedule job hunting workers for websites. Initially only linkedin would be supported. The user can add job boards and configure a schedule on how often to check for postings. 


The backend side would have the following responsibilities
1. Navigate job posting boards and add to a queue. These would initially be added to the backlog swim lane.
2. Process applications in the backlog swim lane, filling appropriate fields. If any information is missing, the application will be moved to the action required swim lane. Where the user can provide the missing information; updating their profile and moving the application back to the backlog swim lane.
3. If the user has connected an email service, emails will be monitored for updates to the application status. If the status changes, the application will be moved to the appropriate swim lane. This is where custom swim lanes would be most useful. (User added Interview, Offer etc. an LLM can decide which swim lane to move the application to).
4. A resume builder, given a job description the service will be able to generate a resume.

Feel free to suggest features.

This entire project is supposed to be a monolith, but I think it would be better to manage multiple sub services as a mono repo and have a docker compose file to manage the services. I don't want scalability as this is a single user application. Also for the design doc, feel free to create separate files for each proposed service.
