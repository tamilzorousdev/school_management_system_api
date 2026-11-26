# Module List (Draft)

Proposed module split for the module-wise scope document. It follows the 8 groups in Scope Document v1.1 section 5 and is checked against the API modules (`apps/school-api/src/modules/`) and the web features (`src/features/`).

## A. School setup and administration
1. **Authentication and sessions**: OTP login, tokens, logout, devices
2. **Roles, permissions and users**: access catalog, user management
3. **Schools and tenancy setup**: school creation, academic years, classes and sections, subjects, settings
4. **App banners, files and signatures**: banners, uploads, digital signatures
5. **Dashboard and reports**: role dashboards, insights

## B. Students and admissions
6. **Admissions and student records**: students, guardians, documents, ID cards and QR
7. **Student import**: bulk import
8. **Student lifecycle**: promotion, transfer, TC, withdrawal

## C. Academics
9. **Timetable and substitutes**
10. **Attendance** (student)
11. **Diary and homework**
12. **Exams and results**
13. **Quizzes**
14. **Activities, achievements and performance**
15. **Events**

## D. Staff and HR
16. **Staff records**
17. **Staff attendance**
18. **Staff leave**
19. **Payroll**
20. **Appraisals**

## E. Finance
21. **Fees**: structures, collection, discounts, refunds, late fees, online payments
22. **Accounts**: expenses, income, approvals

## F. Communication
23. **Announcements and notifications**: push, SMS, templates
24. **Chat**
25. **Meetings and calls**
26. **Surveys and feedback forms**
27. **Emergency broadcasts**

## G. Transport and fleet
28. **Transport**: routes, stops, bus passes, transport fees
29. **Fleet and live tracking**: buses, Telematics read-only status
30. **Crew and driver app**: drivers, attendants, trips, boarding, SOS
31. **Fleet maintenance**

## H. Campus operations
32. **Gate and visitors**: gate passes
33. **Library**
34. **Inventory**

## I. Cross-cutting
35. **Mobile app shells**: Staff, Parent and Driver menus. Parent and teacher previews are in the web.

## Suggested merges (35 to about 25)

- Merge 4 into 3.
- Merge 7 into 6, and 8 into 6 or keep it on its own.
- Merge 17 and 18 into one "Staff attendance and leave".
- Merge 20 into 19, or into 16.
- Merge 28 and 31 into the transport chapters.
- Merge 35 into the per-role mobile coverage.

## Open decisions

1. 35-module split or the merged ~25?
2. Which modules are out of the first pass? Fleet and Telematics only read from another service, so they could be a light chapter.
3. Mobile menus inside each module chapter (suggested, with a screen table per platform) or in their own chapter?
