const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hoy = () => new Date().toLocaleDateString('sv-SE');

const TIPO_DE_GRILLA = { celulares: 'Celular', lineas: 'Linea' };
const estado = { vista: 'celulares', filtros: {}, opciones: null };

async function api(url, { method = 'GET', body } = {}) {
  const r = await fetch(url, {
    method,
    headers: body !== undefined && typeof body !== 'string' ? { 'Content-Type': 'application/json' } : {},
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && !url.endsWith('/login')) {
    mostrarLogin();
    throw new Error(datos.error ?? 'Sesion vencida');
  }
  if (!r.ok) throw new Error(datos.error ?? `Error ${r.status}`);
  return datos;
}

function avisar(texto) {
  const aviso = $('#aviso');
  aviso.textContent = texto;
  aviso.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => { aviso.hidden = true; }, 3500);
}

// ---------------------------------------------------------------- sesion

function mostrarLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
}

async function iniciar(sesion) {
  $('#usuario').textContent = `${sesion.sigla} - ${sesion.nombre}`;
  $('#login').hidden = true;
  $('#app').hidden = false;
  estado.opciones = await api('/api/opciones');
  irA(estado.vista);
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await iniciar(await api('/api/login', { method: 'POST', body: { sigla: e.target.sigla.value } }));
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#salir').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  mostrarLogin();
});

$('#pestanas').addEventListener('click', (e) => {
  const vista = e.target.dataset?.vista;
  if (vista) irA(vista);
});

// ---------------------------------------------------------------- grillas

function irA(vista, filtros) {
  estado.vista = vista;
  if (filtros) estado.filtros[vista] = filtros;
  document.querySelectorAll('#pestanas button').forEach((b) => b.classList.toggle('activa', b.dataset.vista === vista));
  if (vista === 'interfaz') return mostrarInterfaz();
  mostrarGrilla(vista);
}

function consultaFiltros(vista) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(estado.filtros[vista] ?? {})) if (v) params.set(k, v);
  return params.toString();
}

function chipEstado(valor) {
  return `<span class="estado ${esc(String(valor).replace(/ /g, '-'))}">${esc(valor)}</span>`;
}

function botonesFila(vista, fila) {
  const b = (accion, texto) => `<button class="mini" data-accion="${accion}" data-id="${esc(fila.id ?? fila.id_empleado)}">${texto}</button>`;
  const tipo = TIPO_DE_GRILLA[vista];
  if (tipo) {
    const manuales = estado.opciones[tipo].estadosManuales;
    return [
      b('editar', 'Editar'),
      fila.estado !== 'Baja' ? b('baja', 'Baja') : '',
      manuales.includes(fila.estado) ? b('estado', 'Estado') : '',
      b('ver-asignaciones', 'Asignaciones'),
      b('historial', 'Historial'),
    ].join('');
  }
  if (vista === 'asignaciones') {
    return [
      fila.situacion === 'Vigente' ? b('devolver', 'Devolver') : '',
      b('observacion', 'Observacion'),
      b('historial', 'Historial'),
    ].join('');
  }
  if (vista === 'empleados') return b('ver-asignaciones', 'Asignaciones');
  return '';
}

async function mostrarGrilla(vista) {
  const consulta = consultaFiltros(vista);
  let resultado;
  try {
    resultado = await api(`/api/grillas/${vista}?${consulta}`);
  } catch (err) {
    $('#contenido').innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  if (estado.vista !== vista) return;
  const filtros = estado.filtros[vista] ?? {};
  const conAcciones = vista !== 'auditoria';
  const nuevo = { celulares: 'Nuevo celular', lineas: 'Nueva linea', asignaciones: 'Nueva asignacion' }[vista];

  $('#herramientas').innerHTML = `
    ${nuevo ? `<button data-accion="nuevo">${nuevo}</button>` : ''}
    <button class="secundario" data-accion="exportar">Exportar a Excel</button>
    <button class="secundario" data-accion="limpiar">Limpiar filtros</button>
    <span class="contador">${resultado.filas.length < resultado.total
      ? `Mostrando ${resultado.filas.length} de ${resultado.total} (refine los filtros; la exportacion incluye todas)`
      : `${resultado.total} registro(s)`}</span>`;

  const columnas = resultado.columnas;
  const filasHtml = resultado.filas.map((fila) => `<tr>
      ${conAcciones ? `<td class="acciones">${botonesFila(vista, fila)}</td>` : ''}
      ${columnas.map(([c]) => `<td>${c === 'estado' || c === 'situacion' ? chipEstado(fila[c]) : esc(fila[c])}</td>`).join('')}
    </tr>`).join('');

  $('#contenido').innerHTML = `<div class="tabla-contenedor"><table>
    <thead>
      <tr>${conAcciones ? '<th></th>' : ''}${columnas.map(([, t]) => `<th>${esc(t)}</th>`).join('')}</tr>
      <tr class="filtros">${conAcciones ? '<th></th>' : ''}${columnas.map(([c, t]) =>
        `<th><input data-filtro="${c}" value="${esc(filtros[c])}" placeholder="Filtrar" aria-label="Filtrar ${esc(t)}"></th>`).join('')}</tr>
    </thead>
    <tbody>${filasHtml || `<tr><td colspan="${columnas.length + 1}" class="sutil">Sin resultados</td></tr>`}</tbody>
  </table></div>`;
  estado.filas = resultado.filas;
}

let temporizadorFiltro;
$('#contenido').addEventListener('input', (e) => {
  const campo = e.target.dataset.filtro;
  if (!campo) return;
  const vista = estado.vista;
  estado.filtros[vista] = { ...estado.filtros[vista], [campo]: e.target.value };
  clearTimeout(temporizadorFiltro);
  temporizadorFiltro = setTimeout(async () => {
    const enfocado = document.activeElement?.dataset?.filtro;
    await mostrarGrilla(vista);
    if (enfocado) {
      const input = document.querySelector(`[data-filtro="${enfocado}"]`);
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  }, 300);
});

$('#herramientas').addEventListener('click', (e) => {
  const accion = e.target.dataset?.accion;
  const vista = estado.vista;
  if (accion === 'exportar') window.location = `/api/grillas/${vista}/xlsx?${consultaFiltros(vista)}`;
  if (accion === 'limpiar') irA(vista, {});
  if (accion === 'nuevo') (vista === 'asignaciones' ? dialogoAsignar() : dialogoRecurso(TIPO_DE_GRILLA[vista]));
});

$('#contenido').addEventListener('click', (e) => {
  const { accion, id } = e.target.dataset ?? {};
  if (!accion) return;
  const vista = estado.vista;
  const tipo = TIPO_DE_GRILLA[vista];
  const fila = estado.filas.find((f) => (f.id ?? f.id_empleado) === id);
  if (accion === 'editar') dialogoRecurso(tipo, id);
  if (accion === 'baja') dialogoBaja(tipo, fila);
  if (accion === 'estado') dialogoEstado(tipo, fila);
  if (accion === 'historial') irA('auditoria', { entidad: tipo ?? 'Asignacion', id_registro: id });
  if (accion === 'ver-asignaciones') irA('asignaciones', vista === 'empleados' ? { id_empleado: id } : { id_recurso: id });
  if (accion === 'devolver') dialogoDevolver(fila);
  if (accion === 'observacion') dialogoObservacion(fila);
});

// ---------------------------------------------------------------- dialogos

function campo({ nombre, etiqueta, tipo = 'text', valor = '', opciones, requerido, lista, ayuda }) {
  const req = requerido ? 'required' : '';
  let control;
  if (opciones) {
    control = `<select name="${nombre}" ${req}>${opciones.map(([v, t]) =>
      `<option value="${esc(v)}" ${v === valor ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  } else if (tipo === 'textarea') {
    control = `<textarea name="${nombre}" rows="3">${esc(valor)}</textarea>`;
  } else {
    control = `<input name="${nombre}" type="${tipo}" value="${esc(valor)}" ${req} ${lista ? `list="${lista}"` : ''}>`;
  }
  return `<label>${esc(etiqueta)}${requerido ? ' *' : ''}${control}${ayuda ? `<span class="sutil">${esc(ayuda)}</span>` : ''}</label>`;
}

function abrirDialogo(titulo, cuerpoHtml, alAceptar, textoAceptar = 'Guardar') {
  const dlg = $('#dialogo');
  $('#dialogo-titulo').textContent = titulo;
  $('#dialogo-cuerpo').innerHTML = cuerpoHtml;
  $('#dialogo-error').textContent = '';
  $('#dialogo-aceptar').textContent = textoAceptar;
  const form = $('#form-dialogo');
  form.onsubmit = async (e) => {
    e.preventDefault();
    $('#dialogo-aceptar').disabled = true;
    try {
      const mensaje = await alAceptar(form);
      dlg.close();
      if (mensaje) avisar(mensaje);
      mostrarGrilla(estado.vista);
    } catch (err) {
      $('#dialogo-error').textContent = err.message;
    } finally {
      $('#dialogo-aceptar').disabled = false;
    }
  };
  $('#dialogo-cancelar').onclick = () => dlg.close();
  dlg.showModal();
}

const datosForm = (form) => Object.fromEntries(new FormData(form).entries());

const CAMPOS_RECURSO = {
  Celular: [
    { nombre: 'marca', etiqueta: 'Marca', requerido: true },
    { nombre: 'modelo', etiqueta: 'Modelo', requerido: true },
    { nombre: 'imei', etiqueta: 'IMEI', requerido: true, ayuda: '15 digitos' },
    { nombre: 'fecha_compra', etiqueta: 'Fecha de compra', tipo: 'date', requerido: true },
    { nombre: 'proveedor', etiqueta: 'Proveedor', requerido: true },
    { nombre: 'observacion', etiqueta: 'Observacion', tipo: 'textarea' },
  ],
  Linea: [
    { nombre: 'numero', etiqueta: 'Numero de linea', requerido: true },
    { nombre: 'prestador', etiqueta: 'Prestador', requerido: true },
    { nombre: 'nro_cuenta', etiqueta: 'Nro. de cuenta', requerido: true },
    { nombre: 'plan', etiqueta: 'Plan', requerido: true },
    { nombre: 'fecha_compra', etiqueta: 'Fecha de compra', tipo: 'date', requerido: true },
    { nombre: 'nro_sim', etiqueta: 'Nro. de SIM', requerido: true },
    { nombre: 'observacion', etiqueta: 'Observacion', tipo: 'textarea' },
  ],
};

async function dialogoRecurso(tipo, id) {
  const ruta = `/api/recursos/${tipo === 'Celular' ? 'celulares' : 'lineas'}`;
  const actual = id ? await api(`${ruta}/${id}`) : {};
  const nombre = tipo === 'Celular' ? 'celular' : 'linea';
  const cuerpo = (id ? `<p class="sutil">ID inventario ${esc(id)} - estado ${esc(actual.estado)}</p>`
    : '<p class="sutil">El ID se genera automaticamente y el estado inicial es "Disponible".</p>')
    + CAMPOS_RECURSO[tipo].map((c) => campo({ ...c, valor: actual[c.nombre] ?? '' })).join('');
  abrirDialogo(id ? `Modificar ${nombre}` : `Alta de ${nombre}`, cuerpo, async (form) => {
    const r = await api(id ? `${ruta}/${id}` : ruta, { method: id ? 'PUT' : 'POST', body: datosForm(form) });
    return id ? `Se modifico ${r.id}` : `Se dio de alta ${r.id}`;
  });
}

function dialogoBaja(tipo, fila) {
  const ruta = `/api/recursos/${tipo === 'Celular' ? 'celulares' : 'lineas'}/${fila.id}`;
  const motivos = estado.opciones[tipo].motivosBaja;
  const aviso = fila.estado === 'En Uso'
    ? '<p class="sutil">Esta En Uso: su asignacion vigente se cerrara con la fecha de baja.</p>' : '';
  abrirDialogo(`Baja de ${fila.id}`, aviso
    + campo({ nombre: 'fecha_baja', etiqueta: 'Fecha de baja', tipo: 'date', valor: hoy(), requerido: true })
    + campo({ nombre: 'motivo_baja', etiqueta: 'Motivo', requerido: true, opciones: [['', 'Elegir...'], ...motivos.map((m) => [m, m])] }),
  async (form) => {
    await api(`${ruta}/baja`, { method: 'POST', body: datosForm(form) });
    return `${fila.id} quedo en estado Baja`;
  }, 'Dar de baja');
}

function dialogoEstado(tipo, fila) {
  const ruta = `/api/recursos/${tipo === 'Celular' ? 'celulares' : 'lineas'}/${fila.id}`;
  const opciones = estado.opciones[tipo].estadosManuales.filter((e) => e !== fila.estado);
  abrirDialogo(`Cambiar estado de ${fila.id}`, `<p class="sutil">Estado actual: ${esc(fila.estado)}</p>`
    + campo({ nombre: 'estado', etiqueta: 'Nuevo estado', requerido: true, opciones: opciones.map((e) => [e, e]) }),
  async (form) => {
    const r = await api(`${ruta}/estado`, { method: 'POST', body: datosForm(form) });
    return `${fila.id} paso a "${r.estado}"`;
  }, 'Cambiar');
}

async function dialogoAsignar() {
  const [empleados, celulares, lineas] = await Promise.all([
    api('/api/empleados/activos'),
    api('/api/recursos/celulares/disponibles'),
    api('/api/recursos/lineas/disponibles'),
  ]);
  const lista = `<datalist id="lista-empleados">${empleados.map((e) =>
    `<option value="${esc(e.id_empleado)} - ${esc(e.nombre)} (legajo ${esc(e.legajo)}${e.sigla ? ', ' + esc(e.sigla) : ''})"></option>`).join('')}</datalist>`;
  const opciones = (items) => [['', '- Ninguno -'], ...items.map((i) => [i.id, `${i.id} - ${i.descripcion}`])];
  abrirDialogo('Nueva asignacion', lista
    + campo({ nombre: 'empleado', etiqueta: 'Empleado', requerido: true, lista: 'lista-empleados', ayuda: 'Escriba nombre, legajo o sigla y elija de la lista' })
    + campo({ nombre: 'id_celular', etiqueta: `Celular (${celulares.length} disponibles)`, opciones: opciones(celulares) })
    + campo({ nombre: 'id_linea', etiqueta: `Linea (${lineas.length} disponibles)`, opciones: opciones(lineas) })
    + campo({ nombre: 'fecha_asignacion', etiqueta: 'Fecha de asignacion', tipo: 'date', valor: hoy(), requerido: true })
    + campo({ nombre: 'observacion', etiqueta: 'Observacion', tipo: 'textarea' }),
  async (form) => {
    const datos = datosForm(form);
    datos.id_empleado = datos.empleado.split(' - ')[0].trim();
    const creadas = await api('/api/asignaciones', { method: 'POST', body: datos });
    return `Asignacion(es) creada(s): ${creadas.map((a) => `${a.id} (${a.tipo} ${a.id_recurso})`).join(', ')}`;
  }, 'Asignar');
}

async function dialogoDevolver(fila) {
  const vigentes = await api(`/api/empleados/${encodeURIComponent(fila.id_empleado)}/vigentes`);
  const items = vigentes.map((a) => {
    const estados = estado.opciones[a.tipo].estadosDevolucion;
    const desc = a.tipo === 'Celular' ? `${a.marca} ${a.modelo} - IMEI ${a.imei}` : `${a.numero_linea} - ${a.prestador}`;
    return `<div class="item-devolucion">
      <input type="checkbox" name="sel" value="${esc(a.id)}" ${a.id === fila.id ? 'checked' : ''} aria-label="Devolver ${esc(a.id)}">
      <span><strong>${esc(a.tipo)} ${esc(a.id_recurso)}</strong><br><span class="sutil">${esc(desc)} - desde ${esc(a.fecha_asignacion)}</span></span>
      <select name="estado_${esc(a.id)}" aria-label="Estado de ${esc(a.id_recurso)}">
        <option value="">Estado...</option>${estados.map((e) => `<option>${esc(e)}</option>`).join('')}
      </select>
    </div>`;
  }).join('');
  abrirDialogo(`Devolucion - ${fila.nombre}`, items
    + campo({ nombre: 'fecha_devolucion', etiqueta: 'Fecha de devolucion', tipo: 'date', valor: hoy(), requerido: true }),
  async (form) => {
    const datos = new FormData(form);
    const seleccion = datos.getAll('sel').map((id) => ({ id_asignacion: id, estado: datos.get(`estado_${id}`) }));
    if (!seleccion.length) throw new Error('Marque al menos un celular o linea a devolver');
    if (seleccion.some((s) => !s.estado)) throw new Error('Elija el estado en que queda cada celular o linea devuelto');
    await api('/api/devoluciones', { method: 'POST', body: { fecha_devolucion: datos.get('fecha_devolucion'), items: seleccion } });
    return `Devolucion registrada (${seleccion.length})`;
  }, 'Registrar devolucion');
}

function dialogoObservacion(fila) {
  abrirDialogo(`Observacion de ${fila.id}`,
    campo({ nombre: 'observacion', etiqueta: 'Observacion', tipo: 'textarea', valor: fila.observacion ?? '' }),
    async (form) => {
      await api(`/api/asignaciones/${fila.id}/observacion`, { method: 'PUT', body: datosForm(form) });
      return 'Observacion actualizada';
    });
}

// ---------------------------------------------------------------- interfaz RRHH

function mostrarInterfaz() {
  $('#herramientas').innerHTML = '';
  $('#contenido').innerHTML = `<div class="panel">
    <h2>Procesar interfaz de RRHH</h2>
    <p class="sutil">Archivo CSV con el padron completo, separado por ";" o ",", con encabezado:<br>
      <code>id_empleado;legajo;nombre;sector;area;gerencia;sigla;centro_costo;fecha_alta;fecha_baja</code><br>
      Las bajas generan la devolucion automatica (usuario INTERFACE). Las bajas a futuro se descartan hasta una proxima iteracion.</p>
    <input type="file" id="archivo-rrhh" accept=".csv,text/csv">
    <div><button id="procesar-rrhh">Procesar</button></div>
    <pre id="resultado-rrhh" hidden></pre>
  </div>`;
  $('#procesar-rrhh').onclick = async () => {
    const archivo = $('#archivo-rrhh').files[0];
    const salida = $('#resultado-rrhh');
    salida.hidden = false;
    if (!archivo) { salida.textContent = 'Elija un archivo.'; return; }
    salida.textContent = 'Procesando...';
    try {
      const r = await api('/api/interfaz/rrhh', { method: 'POST', body: await archivo.text() });
      salida.textContent = [
        `Fecha de proceso: ${r.fecha_proceso}`,
        `Altas: ${r.altas}`, `Modificaciones: ${r.modificaciones}`,
        `Bajas procesadas: ${r.bajas_procesadas}`, `Bajas a futuro descartadas: ${r.bajas_futuras_descartadas}`,
        `Devoluciones generadas: ${r.devoluciones_generadas}`,
        r.errores.length ? `Errores:\n  ${r.errores.join('\n  ')}` : 'Sin errores',
      ].join('\n');
    } catch (err) {
      salida.textContent = err.message;
    }
  };
}

// ---------------------------------------------------------------- arranque

api('/api/sesion').then(iniciar).catch(mostrarLogin);
