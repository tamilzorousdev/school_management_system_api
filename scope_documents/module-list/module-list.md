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
8. **Student lifecycle**: promotion, transfer, TC, withdrawal, No Objection Certificate
9. **Alumni**: alumni records, public alumni page (Group B, chapter 8 ALM)

## C. Academics
10. **Timetable and substitutes**
11. **Attendance** (student)
12. **Diary and homework**
13. **Exams and results**
14. **Quizzes**
15. **Activities, achievements and performance**: includes parent ratings and teacher term feedback
16. **Events**

## D. Staff and HR
17. **Staff records**
18. **Staff attendance**
19. **Staff leave**
20. **Payroll**
21. **Appraisals**

## E. Finance
22. **Fees**: structures, collection, discounts, refunds, late fees, online payments
23. **Accounts**: expenses, income, approvals

## F. Communication
24. **Announcements and notifications**: push, SMS, templates
25. **Chat**
26. **Meetings and calls**
27. **Surveys and feedback forms**
28. **Emergency broadcasts**
29. **Grievances**

## G. Transport and fleet
30. **Transport**: routes, stops, bus passes, transport fees
31. **Fleet and live tracking**: buses, Telematics read-only status
32. **Crew and driver role**: drivers, attendants, trips, boarding, SOS (SMS Transport app)
33. **Fleet maintenance**
34. **Transport in-charge**: `admin` console plus `mobile/transport` routes (no Flutter app carries this role)

## H. Campus operations
35. **Gate and visitors**: gate passes
36. **Library**
37. **Inventory**
38. **Hostel**: admissions, rooms, movement, care, conduct, duty, safety, reports; Warden and Assistant warden roles
39. **Canteen**: menu, orders, kitchen, wallet, stock, purchases, staff, waste, feedback
40. **Gallery**: albums, content, mobile galleries

## I. Cross-cutting
41. **Mobile apps**: three Android apps built from shared packages, every one with the Parent role: SMS (Parent and Staff), SMS Transport (Parent and Driver), SMS Office (Parent and Office). Role chooser, menus and tabs per app. Parent and teacher previews are in the web.
42. **Office app (AO)**: head AO and wing AO, `admin/office` and `mobile/office` routes, home and wings, classes, sections and students, student history, gate pass approvals (own scope document in `scope_documents/office-app/`)

## Suggested merges (42 to about 30)

- Merge 4 into 3.
- Merge 7 into 6, and 8 and 9 into one "Student lifecycle and alumni" chapter, or keep them on their own.
- Merge 18 and 19 into one "Staff attendance and leave".
- Merge 21 into 20, or into 17.
- Merge 30, 33 and 34 into the transport chapters.
- Merge 38, 39 and 40 into a light "Campus services" chapter if the first pass is short.
- Merge 41 and 42 into the per-role mobile coverage.

## Open decisions

1. 42-module split or the merged ~30?
2. Which modules are out of the first pass? Fleet and Telematics only read from another service, so they could be a light chapter. Hostel, Canteen and Gallery have no scope document yet.
3. Mobile menus inside each module chapter (suggested, with a screen table per app and role) or in their own chapter?
4. The Transport in-charge has API routes but no Flutter app: build the screens or leave the role web-only?
