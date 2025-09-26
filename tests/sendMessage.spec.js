// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Pruebas e2e para el sistema de envío de mensajes CRM WhatsApp
 * Estas pruebas replican los fallos identificados en el análisis del código
 */

test.describe('Sistema de Envío de Mensajes', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navegar a la aplicación
    await page.goto('/');
    
    // Simular login (asumiendo que hay credenciales de prueba)
    // Nota: En un entorno real, esto debería usar credenciales de test
    await page.waitForSelector('[data-testid="login-form"]', { timeout: 10000 });
  });

  test('Debería mostrar error cuando el proxy del backend no está disponible', async ({ page }) => {
    // Interceptar las llamadas a la API para simular error de proxy
    await page.route('**/api/sendMessage', route => {
      route.abort('failed');
    });

    // Intentar enviar un mensaje después del login
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'testpassword');
    await page.click('[data-testid="login-button"]');
    
    // Esperar a que cargue la interfaz principal
    await page.waitForSelector('[data-testid="chat-window"]', { timeout: 15000 });
    
    // Seleccionar una conversación
    await page.click('[data-testid="conversation-item"]:first-child');
    
    // Intentar enviar un mensaje
    await page.fill('[data-testid="message-input"]', 'Mensaje de prueba');
    await page.click('[data-testid="send-button"]');
    
    // Verificar que se muestra el error
    await expect(page.locator('[data-testid="error-alert"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-alert"]')).toContainText('Error');
  });

  test('Debería manejar correctamente números argentinos con formato incorrecto', async ({ page }) => {
    // Simular respuesta del backend con error de formato de número
    await page.route('**/api/sendMessage', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: 'INVALID_PHONE_FORMAT',
          message: 'Formato de número telefónico inválido'
        })
      });
    });

    // Login y navegación
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'testpassword');
    await page.click('[data-testid="login-button"]');
    
    await page.waitForSelector('[data-testid="chat-window"]', { timeout: 15000 });
    await page.click('[data-testid="conversation-item"]:first-child');
    
    // Intentar enviar mensaje
    await page.fill('[data-testid="message-input"]', 'Mensaje de prueba');
    await page.click('[data-testid="send-button"]');
    
    // Verificar manejo del error específico
    await expect(page.locator('[data-testid="error-alert"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-alert"]')).toContainText('INVALID_PHONE_FORMAT');
  });

  test('Debería mostrar estado de envío correctamente', async ({ page }) => {
    // Simular respuesta exitosa del backend
    await page.route('**/api/sendMessage', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          messageId: 'test-message-id-123',
          status: 'sent'
        })
      });
    });

    // Login y navegación
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'testpassword');
    await page.click('[data-testid="login-button"]');
    
    await page.waitForSelector('[data-testid="chat-window"]', { timeout: 15000 });
    await page.click('[data-testid="conversation-item"]:first-child');
    
    // Enviar mensaje
    const messageText = 'Mensaje de prueba exitoso';
    await page.fill('[data-testid="message-input"]', messageText);
    await page.click('[data-testid="send-button"]');
    
    // Verificar que el mensaje aparece en el chat
    await expect(page.locator('[data-testid="message-item"]').last()).toContainText(messageText);
    
    // Verificar que no hay errores
    await expect(page.locator('[data-testid="error-alert"]')).not.toBeVisible();
  });

  test('Debería manejar correctamente el envío de archivos multimedia', async ({ page }) => {
    // Simular respuesta exitosa para upload
    await page.route('**/api/upload', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          url: 'https://example.com/test-image.jpg'
        })
      });
    });

    // Simular respuesta exitosa para sendMessage con imagen
    await page.route('**/api/sendMessage', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          messageId: 'test-image-message-id',
          status: 'sent'
        })
      });
    });

    // Login y navegación
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'testpassword');
    await page.click('[data-testid="login-button"]');
    
    await page.waitForSelector('[data-testid="chat-window"]', { timeout: 15000 });
    await page.click('[data-testid="conversation-item"]:first-child');
    
    // Abrir menú de adjuntos
    await page.click('[data-testid="attachment-button"]');
    
    // Simular selección de archivo (esto requiere un archivo de prueba)
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-image.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('fake-image-data')
    });
    
    // Verificar que se procesa el archivo
    await expect(page.locator('[data-testid="message-item"]').last()).toBeVisible();
  });

  test('Debería resetear correctamente el estado de envío después de error', async ({ page }) => {
    // Simular error en el primer intento
    let callCount = 0;
    await page.route('**/api/sendMessage', route => {
      callCount++;
      if (callCount === 1) {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: 'SERVER_ERROR',
            message: 'Error interno del servidor'
          })
        });
      } else {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            messageId: 'test-retry-message-id',
            status: 'sent'
          })
        });
      }
    });

    // Login y navegación
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'testpassword');
    await page.click('[data-testid="login-button"]');
    
    await page.waitForSelector('[data-testid="chat-window"]', { timeout: 15000 });
    await page.click('[data-testid="conversation-item"]:first-child');
    
    // Primer intento (fallará)
    await page.fill('[data-testid="message-input"]', 'Mensaje que fallará');
    await page.click('[data-testid="send-button"]');
    
    // Verificar error
    await expect(page.locator('[data-testid="error-alert"]')).toBeVisible();
    
    // Cerrar alerta de error
    await page.click('[data-testid="error-alert"] button');
    
    // Segundo intento (debería funcionar)
    await page.fill('[data-testid="message-input"]', 'Mensaje que funcionará');
    await page.click('[data-testid="send-button"]');
    
    // Verificar que el botón de envío no está deshabilitado
    await expect(page.locator('[data-testid="send-button"]')).not.toBeDisabled();
    
    // Verificar que el mensaje se envía correctamente
    await expect(page.locator('[data-testid="message-item"]').last()).toContainText('Mensaje que funcionará');
  });
});