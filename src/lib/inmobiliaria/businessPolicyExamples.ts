import { emptyPolicy, type BusinessPolicy, type PolicyContent } from './businessPolicies'

/** Isolated fixtures: kept outside business_policies.items so older deployments cannot publish them to real leads. */
export function businessPolicyExamples(now: string): BusinessPolicy[] {
  const examples: Array<Partial<PolicyContent> & { id: string }> = [
    { id: 'remote-information', title: 'Atención a residentes en el extranjero', topic: 'compra_exterior',
      content: 'La información del proyecto y la orientación inicial pueden brindarse a distancia. Residir fuera de Ecuador no impide recibir el brochure ni analizar las opciones. La modalidad de reserva, firma y cierre debe confirmarla un asesor para cada caso; no se garantiza que toda la compra pueda completarse a distancia.',
      scope: 'Orientación inicial a personas que residen fuera de Ecuador. No determina nacionalidad, requisitos legales ni aprobación financiera.' },
    { id: 'reservation-conditions', title: 'Solicitud de reserva de una unidad', topic: 'reserva',
      content: 'Antes de iniciar una solicitud de reserva se debe identificar la unidad. El asesor confirma disponibilidad y condiciones. Expresar interés o solicitar la reserva no inmoviliza la unidad ni confirma un pago. No solicitar transferencias ni afirmar una reserva efectiva sin un resultado operativo confirmado.',
      scope: 'Solicitud inicial de reserva; la confirmación corresponde al equipo comercial y al registro de la operación.' },
    { id: 'payment-instructions', title: 'Entrega de instrucciones de pago', topic: 'pagos',
      content: 'Las instrucciones de pago deben ser entregadas por el equipo comercial mediante el canal autorizado. El asistente no inventa cuentas bancarias, no solicita transferencias y no confirma que un comprobante equivalga a un pago validado.',
      scope: 'Consultas sobre cómo pagar y envío de comprobantes. No determina montos, plazos ni condiciones de financiamiento.' },
    { id: 'cancellation-review', title: 'Revisión de solicitudes de cancelación', topic: 'cancelacion',
      content: 'Las solicitudes de cancelación se revisan con el equipo comercial según las condiciones del documento firmado. No se garantiza devolución, monto ni plazo antes de esa revisión. El asistente puede explicar el proceso, pero solo puede afirmar que la solicitud fue derivada si existe confirmación del sistema.',
      scope: 'Orientación sobre cancelaciones. No sustituye las condiciones de cada contrato ni confirma acciones realizadas.' },
  ]
  return examples.map(({ id, ...value }) => {
    const draft = { ...emptyPolicy(), source: 'Configuración del administrador', ...value }
    const published = { ...draft, version: 1, publishedAt: now, publishedBy: 'administrator-scenario' }
    return { id, draft, published, history: [published], restricted: true }
  })
}
