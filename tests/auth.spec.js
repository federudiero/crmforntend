// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Pruebas e2e para el sistema de autenticación
 * Estas pruebas verifican el flujo de login necesario para acceder al CRM
 */

test.describe('Sistema de Autenticación', () => {
  
  test('Debería mostrar la página de login al acceder sin autenticación', async ({ page }) => {
    await page.goto('/');
    
    // Verificar que se muestra el formulario de login
    await expect(page.locator('h1, h2, [data-testid="login-title"]')).toBeVisible();
    await expect(page.locator('input[type="email"], [data-testid="email-input"]')).toBeVisible();
    await expect(page.locator('input[type="password"], [data-testid="password-input"]')).toBeVisible();
    await expect(page.locator('button[type="submit"], [data-testid="login-button"]')).toBeVisible();
  });

  test('Debería mostrar error con credenciales inválidas', async ({ page }) => {
    await page.goto('/');
    
    // Intentar login con credenciales incorrectas
    await page.fill('input[type="email"], [data-testid="email-input"]', 'invalid@example.com');
    await page.fill('input[type="password"], [data-testid="password-input"]', 'wrongpassword');
    await page.click('button[type="submit"], [data-testid="login-button"]');
    
    // Verificar que se muestra un error
    await expect(page.locator('.alert, [data-testid="error-message"], .error')).toBeVisible({ timeout: 10000 });
  });

  test('Debería redirigir al dashboard después de login exitoso', async ({ page }) => {
    // Interceptar la autenticación de Firebase para simular login exitoso
    await page.addInitScript(() => {
      // Mock Firebase Auth
      window.mockFirebaseAuth = true;
    });

    await page.goto('/');
    
    // Simular login exitoso
    await page.fill('input[type="email"], [data-testid="email-input"]', 'test@example.com');
    await page.fill('input[type="password"], [data-testid="password-input"]', 'testpassword');
    await page.click('button[type="submit"], [data-testid="login-button"]');
    
    // Verificar redirección al dashboard/home
    await expect(page).toHaveURL(/\/(home|dashboard|$)/, { timeout: 15000 });
    
    // Verificar elementos del dashboard
    await expect(page.locator('[data-testid="conversations-list"], .conversations, .sidebar')).toBeVisible({ timeout: 10000 });
  });

  test('Debería mantener la sesión después de recargar la página', async ({ page }) => {
    // Simular usuario autenticado
    await page.addInitScript(() => {
      localStorage.setItem('firebase:authUser:mock', JSON.stringify({
        uid: 'test-user-id',
        email: 'test@example.com'
      }));
    });

    await page.goto('/');
    
    // Verificar que va directamente al dashboard
    await expect(page.locator('[data-testid="conversations-list"], .conversations, .sidebar')).toBeVisible({ timeout: 10000 });
    
    // Recargar página
    await page.reload();
    
    // Verificar que sigue autenticado
    await expect(page.locator('[data-testid="conversations-list"], .conversations, .sidebar')).toBeVisible({ timeout: 10000 });
  });

  test('Debería cerrar sesión correctamente', async ({ page }) => {
    // Simular usuario autenticado
    await page.addInitScript(() => {
      localStorage.setItem('firebase:authUser:mock', JSON.stringify({
        uid: 'test-user-id',
        email: 'test@example.com'
      }));
    });

    await page.goto('/');
    
    // Verificar que está en el dashboard
    await expect(page.locator('[data-testid="conversations-list"], .conversations, .sidebar')).toBeVisible({ timeout: 10000 });
    
    // Buscar y hacer click en el botón de logout
    const logoutButton = page.locator('button:has-text("Salir"), button:has-text("Logout"), [data-testid="logout-button"]');
    await logoutButton.click();
    
    // Verificar redirección al login
    await expect(page.locator('input[type="email"], [data-testid="email-input"]')).toBeVisible({ timeout: 10000 });
  });
});