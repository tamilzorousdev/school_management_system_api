# Flutter digest (pub workspace, GetX)

Repo folder: `flutter=` from `paths.js`. Full rules: its CLAUDE.md (756 lines; sections noted below). Its own skills live in `.claude/skills/` there (`widget-catalog`, `flutter-flavors`): read `widget-catalog/SKILL.md` before adding any widget.

## Layout
- Three apps, one shared package set: `apps/sms_teacher_app` (parent + staff), `apps/sms_driver_app` (parent + driver), `apps/sms_office_app` (parent + office). Each `main.dart` is one line calling `bootstrapSmsApp([...modules])`.
- Packages: `sms_core` (role-agnostic: http, model, widgets, theme, language, router), `sms_parent`, `sms_staff`, `sms_staff_shared`, `sms_office`, `sms_driver`. `sms_core` imports no role package; role packages do not import each other (only `sms_staff` and `sms_office` may use `sms_staff_shared`). Checked by `python tool/check_boundaries.py` (must stay 0).
- Routes: no central router. Add the route to the owning module's page list: core `sms_core/lib/routes/core_pages.dart`, parent `sms_parent/lib/view/parent/parent_pages.dart`, staff `sms_staff/lib/view/staff/staff_pages.dart`, staff shared `sms_staff_shared/lib/view/staff_shared/me/staff_self_pages.dart`, office `sms_office/lib/view/office/office_pages.dart`, driver `sms_driver/lib/driver_pages.dart`.

## Screen pattern (CLAUDE.md section 3)
- Every screen is a pair: `foo.dart` (StatelessWidget, layout only) + `foo_controller.dart` (GetxController: all state and API calls, no BuildContext). `static const routeName = '/foo'`; navigate with `Get.toNamed(Foo.routeName)`.
- `Get.put(FooController())` at the top of `build`; state is `.obs`, read inside `Obx`. **Never `setState`** (only dialog-local `StatefulBuilder`, private row widgets, animation/ticker machinery). Wrap the screen in `CoreWidget(loadingStatus: controller.isLoading.value, ...)`.
- Controller pattern: set `isLoading`, call the repository, `if (response.success && response.data != null)` then guard the shape (`is Map` / `is List`), catch with `debugPrint('<method> error: $e')`, `finally` clears loading. An API failure must never crash a screen.

## Networking (section 4)
`View -> Controller -> <Feature>Repository -> HttpRepository.apiRequest -> DioClient`. Never call Dio from a view or controller. Add the endpoint as a `static const String` in `Constants` (`sms_core/lib/utils/constant.dart`, path params as `{id}`), then a one-line static method in the matching repository (`sms_staff/lib/http/teacher_repository.dart`, `sms_parent/lib/http/parent_repository.dart`, or a repository in `sms_core/lib/http/`). Results are `ResponseData { success, data, statusCode, message }`. Do not touch `Constants.BASE_URL`.

## Widgets and style (section 2, mandatory)
Search `packages/sms_core/lib/widgets/` and the app for an existing widget first and say in your reply what you searched and found. Reuse, extend with an optional parameter, or extract when the same inline builder exists twice. No literal colours, radii or text styles: `AppColors`, `AppText`, `AppSpacing`, `AppDecor` in `sms_core/lib/theme/`. New shared widget goes in `sms_core/lib/widgets/` and into the `widget-catalog` skill. Accessibility baseline in section 2.5 (semantic labels, 48dp hit targets, `A11y.announce` next to a snackbar).

## Strings (section 6)
Every user-facing string is `'key'.tr`, added to both `sms_core/lib/language/lang_en.dart` and `lang_ta.dart` with the same `@placeholders`. Counted nouns use `'days_count'.trParams({'n': '$days'})`, never an inline ternary. Tamil runs long: `maxLines` + ellipsis or `Flexible`. After touching translations run `python tool/check_i18n.py`.

## Conventions and done (sections 7 to 9)
`snake_case.dart` files, `PascalCase` classes, `const` constructors, `withValues(alpha:)`. Done = widget check reported, no duplicated widget code, no literal colours, `CoreWidget` wired, route in the module's page list, endpoint in `Constants` + repository, strings in en and ta, `flutter analyze` clean, `check_boundaries.py` and `check_i18n.py` pass. If `flutter` is not on PATH, use the full path to its executable. Commits carry no AI attribution.

## Gotchas found the hard way
- **Close the screen before the toast.** `Get.back(result: ...)` first, then `showSuccessToast(...)`. A toast is a route, so `Get.back()` after it closes the toast and the screen stays open.
- **Never run `dart format` on an existing file you only edited a little.** It rewrites unrelated lines (blank lines, wrapping) and buries your change in noise. Format only the new files you created, or restore the file with git and reapply your edit.
- `ResponseData.payload` is the `data` of the envelope and works for a list as well as a map; `errorCode` is the API's `error` string.
- PUT and PATCH exist in `RequestType`; use them for updates instead of POSTing.
