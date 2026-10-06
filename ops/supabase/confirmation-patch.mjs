export function hostedConfirmationPatch(html) {
  if (
    typeof html !== 'string' ||
    !/\{\{\s*\.Token\s*\}\}/.test(html) ||
    /\{\{\s*\.ConfirmationURL\s*\}\}/.test(html) ||
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal|backbeat|kong|mailpit)(?=[:/?#\s"'<>]|$)/i.test(html)
  ) {
    throw new Error('Invalid hosted confirmation template')
  }
  return {
    mailer_subjects_confirmation: 'Confirm your Backbeat email',
    mailer_templates_confirmation_content: html,
  }
}
