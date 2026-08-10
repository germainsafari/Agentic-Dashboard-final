1. Usability & Billability  
   **KR1: Team Project Utilization**  
* **Metric:** % of time spent on client projects (including Scrum activities)  
* **Target:** ≥ 75%  
* **Aggregation:** Quarterly, per team  
* **Scoro Data Source & Logic:**  
  * Time entries per team  
  * Filters:  
    * Budget Type  {CE, OP, BM, RET}  
    * EXCLUDE activity types from “Internal activities (non-billable)” group  
    * Remaining hours \= Project Utilization Hours. We show % compared to the total hours  
  * **Denominator:** Total person's available hours from Scoro (sb has time off \--\> reduced total availability)


  **KR2: Billable Hours**

* **Metric:** % of total hours billed to client projects \--\> paid by clients  
* **Target:** ≥ 65%  
* **Frequency:** Quarterly  
* No need to redefine logic \- reuse existing billability reporting \- version for Creative Directors  
* no need to include the actual projects/tasks lists

2. Creative Quality

**KR1: First-Time Acceptance Rate (FTA)**

* Metric: % of deliverables accepted without major rework vs all projects of the team  
  * "FTA" meaning: within budget 2 feedback rounds (TBD with Ola)  
* Target: 15% (final target TBD)  
* Scoro Data Source & Logic:  
  * Projects with "FTA" tag  
* Aggregation: Quarterly, per team

**KR2: Projects in Estimate**

* Metric: % of projects delivered within initial estimate  
* Target: ≥ 80%  
* Scoro Data Source & Logic:  
  * Select project status: “Completed” or “Invoiced”  
  * “budget cost” vs “actual cost” (evaluate on full project level, not task level)  
* Aggregation: Quarterly, per team

**KR3: Major Escalations**

* Metric: Number of major client escalations.  Absolute number (not %)  
* Target: ≤ 2 per year  
* Aggregation: Yearly, per team  
* Scoro Data Source & Logic:  
  * Projects with “Escalation” tag  
  * Filter:  
    * Projects assigned to a team/user in the team  
    * Tag \= Escalation  
  * Count occurrences  
3. Business Contribution

**KR1: New Business Pitch Win Rate**

* Metric: % of new business pitches won (% ratio of all projects with “Pitch” tags and “Completed” or “Invoiced” statuses vs projects with “Pitch” tags with the remaining statuses)  
* Target: ≥ 30%  
* Applies to: Teams involved in pitching  
* Scoro Data Source & Logic:  
  * Filter:  
    * Projects with “Pitch” tag  
    * Budget Type: “New Business”  
    * Status: “Completed” or “Invoiced”  
* Aggregation: Quarterly, per team

**KR2: Existing Client Pitch Win Rate**

* Metric: % of pitches won with existing clients (% ratio of all projects with “Pitch” tags and “Completed” or “Invoiced” statuses vs projects with “Pitch” tags with the remaining statuses)  
* Target: ≥ 60%  
* Applies to: Teams involved in pitching  
* Scoro Data Source & Logic:  
  * Filter:  
    * Projects with “Pitch” tag  
    * Budget Type: {CE, OP, BM, RET}  
    * Status: “Completed” or “Invoiced”  
* Aggregation: Quarterly, per team

**KPI Achievement Score**

Definition Number of KPIs achieved vs total.

Example

* “5 out of 6 KPIs achieved”, or %

* all Teams should summarize to the total KPIs Achievement score (not separate score per team)  
* the score should be calculated quarterly but also each consecutive quarter should add up the score of the previous (meaning \- at the end of Q3 we see the score that summarizes Q1,Q2, Q3)  
* plus Ola will share the list of dedicated KPIs per each CDs

