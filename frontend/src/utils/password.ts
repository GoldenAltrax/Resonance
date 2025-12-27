/**
 * Password validation and strength utilities
 */

export interface PasswordValidation {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
}

export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

/**
 * Validates a password against requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 */
export function validatePassword(password: string): PasswordValidation {
  return {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
  };
}

/**
 * Checks if all password requirements are met
 */
export function isPasswordValid(password: string): boolean {
  const validation = validatePassword(password);
  return validation.minLength && validation.hasUppercase && validation.hasLowercase && validation.hasNumber;
}

/**
 * Calculates password strength based on met requirements
 */
export function getPasswordStrength(password: string): PasswordStrength {
  const validation = validatePassword(password);
  const metRequirements = Object.values(validation).filter(Boolean).length;

  if (metRequirements <= 1) return 'weak';
  if (metRequirements === 2) return 'fair';
  if (metRequirements === 3) return 'good';
  return 'strong';
}

/**
 * Get password strength color for UI
 */
export function getStrengthColor(strength: PasswordStrength): string {
  switch (strength) {
    case 'weak':
      return 'bg-red-500';
    case 'fair':
      return 'bg-yellow-500';
    case 'good':
      return 'bg-blue-500';
    case 'strong':
      return 'bg-green-500';
  }
}

/**
 * Get password strength label for UI
 */
export function getStrengthLabel(strength: PasswordStrength): string {
  return strength.charAt(0).toUpperCase() + strength.slice(1);
}
