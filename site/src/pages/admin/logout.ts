import type { APIRoute } from 'astro';
import { sessionFromContext, logout, logAction, csrfValidForm, csrfRefusal } from '../../server/admin-auth.ts';

/* Выход — только POST (minor-9 ревью): GET-выход позволял бы logout-CSRF по картинке/ссылке. */
export const POST: APIRoute = async (ctx) => {
  const form = await ctx.request.formData().catch(() => null);
  if (form && !(await csrfValidForm(ctx, form))) {
    return csrfRefusal(ctx);
  }
  const user = sessionFromContext(ctx);
  if (user) logAction(user.id, 'logout', 'admin_users', user.id);
  logout(ctx);
  return ctx.redirect('/admin/login', 302);
};
