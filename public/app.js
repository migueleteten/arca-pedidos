const firebaseConfig = {
  apiKey: "AIzaSyCjMjLrpXwX-8VdirPZVuckkPFdE8dXn3c",
  authDomain: "pedidos-arca.firebaseapp.com",
  projectId: "pedidos-arca",
  storageBucket: "pedidos-arca.firebasestorage.app",
  messagingSenderId: "542170759816",
  appId: "1:542170759816:web:125815bdec46230d98153d",
  measurementId: "G-28SRL6YKM2"
};

// --- NO CAMBIAR NADA DEBAJO DE ESTA LÍNEA ---

const app = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const functions = app.functions('europe-west1');
const provider = new firebase.auth.GoogleAuthProvider();

// --- Referencias a los elementos del DOM ---
const authControls = document.getElementById('auth-controls');
const appContainer = document.getElementById('app');
const navPedidos = document.getElementById('nav-pedidos');
const navNuevo = document.getElementById('nav-nuevo');
const navSalidaRapida = document.getElementById('nav-salida-rapida');

// --- Router de Vistas ---
const mostrarVista = (vista) => {
    appContainer.innerHTML = ''; // Limpiamos el contenedor principal
    navPedidos.classList.remove('active');
    navNuevo.classList.remove('active');
    navSalidaRapida.classList.remove('active');

    switch (vista) {
        case 'nuevo':
            navNuevo.classList.add('active');
            mostrarVistaNuevoPedido();
            break;
        case 'pedidos':
        default:
            navPedidos.classList.add('active');
            mostrarVistaPedidos();
            break;
        case 'salida-rapida':
            navSalidaRapida.classList.add('active');
            mostrarVistaSalidaRapida();
            break;
    }
};

// --- Funciones para Renderizar cada Vista ---

const mostrarVistaPedidos = async () => {
    // --- Variables de estado ---
    let todosLosPedidos = [];
    let lineasSeleccionadas = new Set();
    let filtroBusqueda = '';
    let soloMisPedidos = false; // Por defecto, los usuarios normales ven todos
    let mostrarPedidosDirectos = false;
    let sortKey = 'fechaCreacion';
    let sortDirection = 'desc';
    let filtrosDeEstadoActivos = [];

    // --- Estructura HTML Principal ---
    const content = `
        <div class="vista-header">
            <h2 class="desktop-only">Mis Pedidos</h2>
            <div id="vista-opciones" class="vista-opciones-grid"></div>
        </div>
        <div id="state-filters-container" class="state-filters"></div>
        <div id="pedidos-container"><table><thead><tr>
            <th id="th-select-all" style="width: 1%;"></th>
            <th data-sort="fechaEntrega">Fecha Entrega</th>
            <th data-sort="expediente">Expediente / Dirección</th>
            <th data-sort="referenciaEspecifica">Referencia Específica</th>
            <th data-sort="codigo">Producto</th>
            <th data-sort="proveedor">Proveedor</th>
            <th data-sort="cantidad">Cant.</th>
            <th data-sort="observaciones">Obs.</th>
            <th data-sort="estado">Estado</th><th>Acciones</th>
        </tr></thead><tbody id="pedidos-tbody"></tbody></table></div>`;
    appContainer.innerHTML = content;
    
    const stateFiltersContainer = document.getElementById('state-filters-container');

    try {
        const adminConfig = await db.collection('config').doc('usuariosAdmin').get();
        const adminEmails = adminConfig.exists ? adminConfig.data().emails : [];
        console.log("PERMISOS DETECTADOS - Lista de Admins:", adminEmails);
        const currentUser = auth.currentUser;
        if (!currentUser) return;
        const esAdmin = adminEmails.includes(currentUser.email);
        
        // --- Generación de Controles Dinámicos ---
        const vistaOpcionesDiv = document.getElementById('vista-opciones');
        let controlesHtml = `<input type="search" id="search-input" placeholder="🔍 Buscar..." class="mobile-hidden">`;
        if (esAdmin) {
            const thSelectAll = document.getElementById('th-select-all');
            thSelectAll.innerHTML = `<input type="checkbox" id="select-all-checkbox">`;
            controlesHtml += `
                <button id="toggle-search-btn" class="icon-button mobile-only" title="Buscar"><span class="material-symbols-outlined">search</span></button>
                <button id="filtro-directos-btn" class="icon-button" title="Mostrar directos a obra"><span class="material-symbols-outlined">visibility_off</span></button>
                <button id="select-all-mobile-btn" class="icon-button mobile-only" title="Seleccionar todo"><span class="material-symbols-outlined">select_all</span></button>`;
        } else {
            // CORRECCIÓN 1: Ocultamos el encabezado del checkbox si no es admin
            const thSelectAll = document.getElementById('th-select-all');
            thSelectAll.style.display = 'none';
            // Por defecto, un usuario normal ve todo. El check activará "sólo mis pedidos".
            soloMisPedidos = false; 
            controlesHtml += `<label class="filtros-switch"><input type="checkbox" id="filtro-mios"> Sólo mis pedidos</label>`;
        }
        vistaOpcionesDiv.innerHTML = controlesHtml;

        const estados = ['Pedido', 'Recibido en Almacén', 'Enviado a Obra', 'Recibido en Destino'];
        document.getElementById('state-filters-container').innerHTML = estados.map(estado => `<button data-estado="${estado}">${estado}</button>`).join('');

        // --- Referencias al DOM (después de crearlos) ---
        const pedidosTbody = document.getElementById('pedidos-tbody');
        const searchInput = document.getElementById('search-input');   

        // --- Funciones auxiliares ---
        const getPedidosFiltrados = () => {
            return todosLosPedidos
                .filter(p => esAdmin ? (mostrarPedidosDirectos || p.pedido.necesitaAlmacen) : (soloMisPedidos ? p.pedido.usuarioEmail === currentUser.email : true))
                // --- BLOQUE DE BÚSQUEDA MODIFICADO ---
                .filter(p => {
                    if (!filtroBusqueda) return true; // Si no hay búsqueda, no filtrar
                    const busquedaLower = filtroBusqueda.toLowerCase();

                    // NUEVO: Comprobar primero si el ID coincide
                    if (p.id.toLowerCase().includes(busquedaLower)) {
                        return true;
                    }

                    // Si no coincide el ID, buscar en el resto de campos como antes
                    return Object.values(p.pedido).some(val => 
                        String(val).toLowerCase().includes(busquedaLower)
                    );
                })
                .filter(p => filtrosDeEstadoActivos.length > 0 ? filtrosDeEstadoActivos.includes(p.pedido.estado) : true);
        };

        const actualizarBarraAcciones = () => {
            const actionBar = document.getElementById('bulk-action-bar');
            if (lineasSeleccionadas.size === 0) {
                actionBar.classList.remove('visible');
                return;
            }
            
            const seleccion = todosLosPedidos.filter(p => lineasSeleccionadas.has(p.id));
            
            // --- LÓGICA CORREGIDA PARA BOTONES EN LOTE ---
            const puedeRecibir = esAdmin && seleccion.every(p => 
                (p.pedido.estado === 'Pedido' || p.pedido.estado === 'Recibido Parcial') && p.pedido.necesitaAlmacen
            );
            const puedeEnviar = esAdmin && seleccion.every(p => 
                (p.pedido.estado === 'Recibido en Almacén' || p.pedido.estado === 'Recibido Parcial' || (p.pedido.estado === 'Pedido' && !p.pedido.necesitaAlmacen))
            );

            actionBar.innerHTML = `<p>${lineasSeleccionadas.size} línea(s) seleccionada(s)</p>
                <button id="bulk-recibir" ${!puedeRecibir ? 'disabled' : ''}>Recibir en Lote</button>
                <button id="bulk-enviar" ${!puedeEnviar ? 'disabled' : ''}>Enviar en Lote</button>`;
            actionBar.classList.add('visible');
        };

        const renderizarTabla = () => {
            const pedidosParaMostrar = getPedidosFiltrados();
            pedidosParaMostrar.sort((a, b) => {
                const valA = a.pedido[sortKey]; const valB = b.pedido[sortKey];
                if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
                if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            });

            if (pedidosParaMostrar.length === 0) {
                pedidosTbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 20px;">No hay pedidos que coincidan.</td></tr>`;
                return;
            }
            const filasHtml = pedidosParaMostrar.map(data => {
                const { pedido, id, movimientos } = data;

                // --- NUEVA LÓGICA DE CÁLCULO DE CANTIDADES Y ESTADO ---
                const totalRecibido = movimientos
                    .filter(m => m.tipo === 'entrada')
                    .reduce((sum, m) => sum + m.cantidadRecibida, 0);
                
                const totalEnviado = movimientos
                    .filter(m => m.tipo === 'salida')
                    .reduce((sum, m) => sum + m.cantidadEnviada, 0);

                let estadoCalculado = pedido.estado; // Usamos el estado guardado como base
                // Podríamos recalcularlo aquí si quisiéramos, pero de momento es suficiente

                // --- NUEVO FORMATO PARA LA CELDA DE CANTIDAD ---
                const cantidadHtml = `
                    <div>Pedido: <strong>${pedido.cantidad} ${pedido.unidadVenta}</strong></div>
                    <div style="color: blue;">Recibido: ${totalRecibido.toFixed(2)}</div>
                    <div style="color: green;">Enviado: ${totalEnviado.toFixed(2)}</div>
                `;

                const isSelected = lineasSeleccionadas.has(id);
                let fechaEntregaFormateada = '-';
                // Comprobamos que el dato existe y es un string
                if (pedido.fechaEntrega && typeof pedido.fechaEntrega === 'string') {
                    const partes = pedido.fechaEntrega.split('-'); // Divide "YYYY-MM-DD" en ["YYYY", "MM", "DD"]
                    if (partes.length === 3) {
                        // Recomponemos como "DD-MM-YY"
                        fechaEntregaFormateada = `${partes[2]}-${partes[1]}-${partes[0].slice(-2)}`;
                    }
                }
                const fecha = fechaEntregaFormateada;
                let accionesHtml = '';
                const obsIcon = pedido.observaciones
                    ? `<span class="material-symbols-outlined" title="${pedido.observaciones}">comment</span>`
                    : ''; // Si no hay, no muestra nada

                // Añadimos la clase 'tiene-observacion' al <tr> si es necesario
                const obsClass = pedido.observaciones ? 'tiene-observacion' : '';

                if (esAdmin) {
                    // Botón Recibir: Visible en 'Pedido' Y 'Recibido Parcial' (si necesita almacén)
                    if ((pedido.estado === 'Pedido' || pedido.estado === 'Recibido Parcial') && pedido.necesitaAlmacen) {
                        accionesHtml += `<button class="icon-button" data-id="${id}" data-action="recibir" title="Recibir"><span class="material-symbols-outlined">warehouse</span></button>`;
                    }
                    // Botón Enviar: Visible en 'Recibido en Almacén', 'Recibido Parcial', o 'Pedido' (si es directo a obra)
                    if (pedido.estado === 'Recibido Completo' || pedido.estado === 'Recibido Parcial' || (pedido.estado === 'Pedido' && !pedido.necesitaAlmacen)) {
                        accionesHtml += `<button class="icon-button" data-id="${id}" data-action="enviar" title="Enviar"><span class="material-symbols-outlined">local_shipping</span></button>`;
                    }
                }
                if (pedido.usuarioEmail === currentUser.email) {
                    if (pedido.estado === 'Enviado a Obra') accionesHtml += `<button class="icon-button" data-id="${id}" data-action="entregado" title="Recibido"><span class="material-symbols-outlined">task_alt</span></button>`;
                    else if (pedido.estado === 'Pedido' && !pedido.necesitaAlmacen) accionesHtml += `<button class="icon-button" data-id="${id}" data-action="entregado_directo" title="Recibido"><span class="material-symbols-outlined">task_alt</span></button>`;
                }
                const statusClass = `status-${pedido.estado.split(' ')[0].toLowerCase()}`;
                return `<tr class="${isSelected ? 'selected' : ''} ${obsClass ? 'tiene-observacion' : ''}" data-id="${id}">
                    ${esAdmin ? `<td data-label="Select"><input type="checkbox" class="linea-checkbox" data-id="${id}" ${isSelected ? 'checked' : ''}></td>` : '<td style="display:none;" data-label="Select"></td>'}
                    <td data-label="Fecha"><small>${fecha} ${pedido.usuarioEmail.split('@')[0]}</small></td>
                    <td data-label="Expediente / Dirección"><strong>${pedido.expediente}</strong><br><small>${pedido.direccion}</small></td>
                    <td data-label="Referencia Específica" class="desktop-only">${pedido.referenciaEspecifica || '-'}</td>
                    <td data-label="Producto"><strong>${pedido.codigo}</strong><br><small>${pedido.descripcion}</small></td>
                    <td data-label="Proveedor"><small>${pedido.proveedor}</small></td>
                    <td data-label="Cantidad">${cantidadHtml}</td>
                    <td data-label="Obs." class="comment-cell">${obsIcon}</td>
                    <td data-label="Estado"><span class="status-badge ${statusClass}">${pedido.estado}</span></td>
                    <td data-label="Acciones / ID">
                        <div style="display: flex; flex-direction: column; align-items: flex-end;">
                            <div>${accionesHtml || ''}</div>
                            <small style="color: #ccc; font-size: 10px;" title="ID de la línea">${id}</small>
                        </div>
                    </td>
                </tr>`;
            }).join('');
            pedidosTbody.innerHTML = filasHtml;
        };

        const abrirModalDeRecepcion = (lineasARecibir) => {
            // Detectamos si el dispositivo es móvil (Android / iOS)
            const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

            // Inicializamos el estado de cada línea
            const estadoLineas = lineasARecibir.map(item => ({
                tipo: 'entrada',
                cantidadRecibida: item.pedido.cantidad,
                nota: '',
                fotoAlbaranFile: null,
            }));
            let fotosGeneralesFiles = [];

            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'modal-overlay';
            modalOverlay.innerHTML = `
                <div class="modal-content">
                    <h3>Registrar Entrada de Mercancía</h3>
                    <div class="general-photo-upload" style="text-align: left; margin-bottom: 20px;">
                        <label for="fotos-generales-input">Fotos Generales del Evento (Palés, etc.)</label>
                        <br>
                        <label class="upload-btn">
                            <span class="material-symbols-outlined">add_a_photo</span> Añadir Fotos
                            <input 
                                type="file" 
                                id="fotos-generales-input" 
                                accept="image/*" 
                                multiple
                                ${isMobile ? 'capture="environment"' : ''}
                            >
                        </label>
                        <div id="general-photo-previews" class="photo-previews"></div>
                    </div>
                    
                    <div id="recepcion-items-list" style="max-height: 40vh; overflow-y: auto;"></div>

                    <div class="modal-buttons" style="margin-top: 20px;">
                        <button id="cancel-recepcion" class="btn-secondary">Cancelar</button>
                        <button id="confirm-recepcion">Confirmar Recepción</button>
                    </div>
                </div>`;

            // --- Función para renderizar los items ---
            const renderizarItemsModal = () => {
                const itemsList = modalOverlay.querySelector('#recepcion-items-list');
                itemsList.innerHTML = lineasARecibir.map((item, index) => {
                    const estadoActual = estadoLineas[index];
                    const udBulto = item.pedido.udBulto || 1;

                    const notaIcon = estadoActual.nota
                        ? `<button class="icon-button notas-btn" data-index="${index}" title="Ver/Editar Nota">
                            <span class="material-symbols-outlined" style="color: var(--color-orange);">speaker_notes</span>
                        </button>`
                        : `<button class="icon-button notas-btn" data-index="${index}" title="Añadir Nota">
                            <span class="material-symbols-outlined" style="color: #ccc;">speaker_notes_off</span>
                        </button>`;

                    const bultosHelper = udBulto !== 1 ? `
                        <div class="helper-text">
                            Ayuda: <input type="number" class="helper-input" data-index="${index}"> bultos
                            (${udBulto} ${item.pedido.unidadVenta}/bulto)
                        </div>` : '';

                    // input de foto de albarán con capture si es móvil
                    const fotoAlbaranHtml = estadoActual.tipo === 'entrada' ? `
                        <div class="item-photo-upload">
                            <label class="upload-btn">
                                <span class="material-symbols-outlined">add_photo_alternate</span>
                                ${estadoActual.fotoAlbaranFile ? '1 FOTO' : 'Albarán*'}
                                <input 
                                    type="file" 
                                    class="foto-albaran-input" 
                                    data-index="${index}" 
                                    accept="image/*"
                                    ${isMobile ? 'capture="environment"' : ''}
                                >
                            </label>
                        </div>` : '<div></div>';

                    return `
                    <div class="recepcion-modal-item" data-id="${item.id}">
                        <div class="info">
                            <strong>${item.pedido.descripcion}</strong>
                            <small>${item.pedido.codigo} | Pedido: ${item.pedido.cantidad} ${item.pedido.unidadVenta}</small>
                        </div>
                        <div class="cantidad-container">
                            <label for="cantidad-recibida-${index}">Cant. Recibida</label>
                            <input type="number" class="main-input" id="cantidad-recibida-${index}" value="${estadoActual.cantidadRecibida}" inputmode="decimal">
                            ${bultosHelper}
                        </div>
                        <div class="item-controls">
                            <button class="control-btn ${estadoActual.tipo === 'entrada' ? 'active' : ''}" data-index="${index}" data-tipo="entrada">🚚 Registrar Entrada</button>
                            <button class="control-btn ${estadoActual.tipo === 'asignacion_stock' ? 'active' : ''}" data-index="${index}" data-tipo="asignacion_stock">📦 Asignar Stock</button>
                            ${notaIcon}
                        </div>
                        <div class="uploads-container">${fotoAlbaranHtml}</div>
                    </div>`;
                }).join('');
            };

            document.body.appendChild(modalOverlay);
            renderizarItemsModal();

            // --- Eventos del modal ---
            const itemsList = modalOverlay.querySelector('#recepcion-items-list');
            const previewsContainer = document.getElementById('general-photo-previews');
            const confirmBtn = document.getElementById('confirm-recepcion');
            const cancelBtn = document.getElementById('cancel-recepcion');

            itemsList.addEventListener('click', e => {
                const controlBtn = e.target.closest('.control-btn');
                const notasBtn = e.target.closest('.notas-btn');

                if (controlBtn) {
                    const index = parseInt(controlBtn.dataset.index);
                    estadoLineas[index].tipo = controlBtn.dataset.tipo;
                    renderizarItemsModal();
                }

                if (notasBtn) {
                    const index = parseInt(notasBtn.dataset.index);
                    const notaActual = estadoLineas[index].nota || "";
                    const nuevaNota = prompt("Nota / Incidencia de la línea:", notaActual);
                    if (nuevaNota !== null) {
                        estadoLineas[index].nota = nuevaNota;
                        renderizarItemsModal();
                    }
                }
            });

            itemsList.addEventListener('input', e => {
                const index = parseInt(e.target.dataset.index);
                if (e.target.classList.contains('helper-input')) {
                    const item = lineasARecibir[index];
                    const bultos = parseFloat(e.target.value) || 0;
                    document.getElementById(`cantidad-recibida-${index}`).value = (bultos * item.pedido.udBulto).toFixed(2);
                }
                if (e.target.classList.contains('main-input')) {
                    estadoLineas[index].cantidadRecibida = parseFloat(e.target.value);
                }
            });

            itemsList.addEventListener('change', e => {
                if (e.target.classList.contains('foto-albaran-input')) {
                    const index = parseInt(e.target.dataset.index);
                    if (e.target.files.length > 0) {
                        estadoLineas[index].fotoAlbaranFile = e.target.files[0];
                        renderizarItemsModal();
                    }
                }
            });

            document.getElementById('fotos-generales-input').addEventListener('change', e => {
                const nuevosArchivos = Array.from(e.target.files);
                fotosGeneralesFiles.push(...nuevosArchivos);
                renderizarFotosGenerales();
            });

            previewsContainer.addEventListener('click', e => {
                if (e.target.tagName === 'IMG') {
                    if (confirm('¿Eliminar esta foto?')) {
                        const index = parseInt(e.target.dataset.index);
                        fotosGeneralesFiles.splice(index, 1);
                        renderizarFotosGenerales();
                    }
                }
            });

            const renderizarFotosGenerales = () => {
                const filePromises = fotosGeneralesFiles.map((file, index) => {
                    return new Promise(resolve => {
                        const reader = new FileReader();
                        reader.onload = event => {
                            resolve(`<img src="${event.target.result}" alt="${file.name}" data-index="${index}">`);
                        };
                        reader.readAsDataURL(file);
                    });
                });
                Promise.all(filePromises).then(imagesHtml => {
                    previewsContainer.innerHTML = imagesHtml.join('');
                });
            };

            cancelBtn.onclick = () => document.body.removeChild(modalOverlay);
            confirmBtn.onclick = async () => {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Subiendo fotos...';

                // --- Lógica de Subida de Archivos a Firebase Storage ---
                const storageRef = firebase.storage().ref();

                // Función auxiliar para subir un solo archivo
                const subirArchivo = async (file, path) => {
                    if (!file) return null;
                    const fileRef = storageRef.child(path);
                    await fileRef.put(file);
                    return fileRef.getDownloadURL();
                };

                try {
                    // 1. Subir todas las fotos generales
                    const promesasFotosGenerales = fotosGeneralesFiles.map((file, i) =>
                        subirArchivo(file, `entradas/generales/${Date.now()}_${i}_${file.name}`)
                    );
                    const urlsFotosGenerales = await Promise.all(promesasFotosGenerales);

                    // 2. Subir las fotos de albarán y preparar el paquete de datos
                    confirmBtn.textContent = 'Registrando entrada...';
                    const recepciones = [];
                    for (let i = 0; i < lineasARecibir.length; i++) {
                        const item = lineasARecibir[i];
                        const estado = estadoLineas[i];

                        const urlFotoAlbaran = await subirArchivo(
                            estado.fotoAlbaranFile,
                            `entradas/albaranes/${item.id}/${Date.now()}_${estado.fotoAlbaranFile?.name}`
                        );

                        // Comprobación de obligatoriedad
                        if (estado.tipo === 'entrada' && !urlFotoAlbaran) {
                            throw new Error(`Falta la foto del albarán para ${item.pedido.descripcion}`);
                        }

                        recepciones.push({
                            id: item.id,
                            tipo: estado.tipo,
                            cantidadRecibida: estado.cantidadRecibida,
                            nota: estado.nota,
                            fotoAlbaranUrl: urlFotoAlbaran,
                        });
                    }
                    
                    // 3. Llamar a la Cloud Function con todos los datos
                    const registrarEntrada = functions.httpsCallable('registrarEntrada');
                    await registrarEntrada({
                        recepciones: recepciones,
                        notasGenerales: document.getElementById('recepcion-notas-generales').value,
                        fotosGeneralesUrls: urlsFotosGenerales,
                    });
                    
                    alert('¡Recepción registrada con éxito!');
                    document.body.removeChild(modalOverlay);

                    lineasSeleccionadas.clear();
                    actualizarBarraAcciones();
                    mostrarVista('pedidos');

                } catch (error) {
                    console.error("Error al confirmar recepción:", error);
                    alert(`Error: ${error.message}`);
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Confirmar Recepción';
                }
            };
        };

        
        // --- Carga inicial de datos ---
        pedidosTbody.innerHTML = `<tr><td colspan="9">Cargando datos...</td></tr>`;

        // 1. Obtenemos todos los pedidos
        const pedidosSnapshot = await db.collection('pedidos').orderBy('fechaCreacion', 'desc').get();
        todosLosPedidos = pedidosSnapshot.docs.map(doc => ({ id: doc.id, pedido: doc.data() }));

        // 2. Obtenemos TODOS los movimientos de una sola vez
        const movimientosSnapshot = await db.collectionGroup('movimientos').get();
        const movimientosPorPedido = new Map();
        movimientosSnapshot.forEach(doc => {
            const pedidoId = doc.ref.parent.parent.id; // Obtenemos el ID del pedido padre
            if (!movimientosPorPedido.has(pedidoId)) {
                movimientosPorPedido.set(pedidoId, []);
            }
            movimientosPorPedido.get(pedidoId).push(doc.data());
        });

        // 3. Unimos los movimientos a sus pedidos correspondientes
        todosLosPedidos.forEach(p => {
            p.movimientos = movimientosPorPedido.get(p.id) || [];
        });
        
        // Renderizamos la tabla por primera vez con los datos completos
        renderizarTabla();

        // --- Asignación de TODOS los Event Listeners ---

        // Listener para Búsqueda
        searchInput.addEventListener('input', e => {
            filtroBusqueda = e.target.value;
            renderizarTabla();
        });

        // Listener para Ordenación por Columnas
        document.querySelectorAll('#pedidos-container th[data-sort]').forEach(th => {
            th.style.cursor = 'pointer';
            th.addEventListener('click', () => {
                const newSortKey = th.dataset.sort;
                // Si se hace clic en la misma columna, se invierte la dirección. Si no, se establece la nueva columna y el orden por defecto.
                if (sortKey === newSortKey) {
                    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    sortKey = newSortKey;
                    sortDirection = 'desc'; // Por defecto, descendente para la nueva columna
                }
                renderizarTabla();
            });
        });

        // Listener para Filtros Rápidos de Estado
        stateFiltersContainer.addEventListener('click', e => {
            if (e.target.tagName === 'BUTTON') {
                const estado = e.target.dataset.estado;
                e.target.classList.toggle('active');
                if (filtrosDeEstadoActivos.includes(estado)) {
                    filtrosDeEstadoActivos = filtrosDeEstadoActivos.filter(s => s !== estado);
                } else {
                    filtrosDeEstadoActivos.push(estado);
                }
                renderizarTabla();
            }
        });

        // Listener para Acciones Individuales y Selección de Filas en la tabla
        pedidosTbody.addEventListener('click', async (e) => {
            const button = e.target.closest('button.icon-button');
            const tr = e.target.closest('tr');
            const commentCell = e.target.closest('.comment-cell');

            // --- Lógica para botones de acción individuales ---
            if (button) {
                e.stopPropagation(); // Prevenimos que se seleccione la fila
                const pedidoId = button.dataset.id;
                const accion = button.dataset.action;

                // Si la acción es 'recibir', abrimos el modal
                if (accion === 'recibir') {
                    const lineaARecibir = todosLosPedidos.find(p => p.id === pedidoId);
                    abrirModalDeRecepcion([lineaARecibir]);
                    return; // Terminamos aquí
                }

                // Para el resto de acciones ('enviar', 'entregado'), mantenemos la lógica anterior
                const estados = {
                    enviar: 'Enviado a Obra',
                    entregado: 'Recibido en Destino',
                    entregado_directo: 'Recibido en Destino'
                };
                const nuevoEstado = estados[accion];

                if (!nuevoEstado || !confirm(`¿Confirmas cambiar el estado a "${nuevoEstado}"?`)) return;

                button.disabled = true;
                try {
                    const actualizarEstado = functions.httpsCallable('actualizarEstadoPedido');
                    await actualizarEstado({ pedidoId: pedidoId, nuevoEstado: nuevoEstado });
                    const indice = todosLosPedidos.findIndex(p => p.id === pedidoId);
                    if (indice !== -1) {
                        todosLosPedidos[indice].pedido.estado = nuevoEstado;
                        renderizarTabla();
                    }
                } catch (error) {
                    console.error("Error al actualizar estado:", error);
                    alert(`Error: ${error.message}`);
                    button.disabled = false;
                }
                return;
            }
            
            // Si se hace clic en una fila (para seleccionar)
            if (tr && tr.dataset.id && esAdmin) {
                const id = tr.dataset.id;
                const checkbox = tr.querySelector('.linea-checkbox');
                if (lineasSeleccionadas.has(id)) {
                    lineasSeleccionadas.delete(id);
                } else {
                    lineasSeleccionadas.add(id);
                }
                if(checkbox) checkbox.checked = lineasSeleccionadas.has(id);
                tr.classList.toggle('selected');
                actualizarBarraAcciones();
            }

            if (commentCell) {
                const tr = commentCell.closest('tr');
                const pedidoId = tr.dataset.id;
                const indice = todosLosPedidos.findIndex(p => p.id === pedidoId);
                if (indice === -1) return;

                const comentario = todosLosPedidos[indice].pedido.observaciones;
                if (comentario) {
                    alert(`Observaciones:\n\n${comentario}`); // Solo muestra el comentario, no pide editar
                }
                return; // Detenemos la ejecución para no seleccionar la fila
            }
            
            if (button && button.dataset.action === 'recibir') {
                e.stopPropagation();
                const pedidoId = button.dataset.id;
                const lineaARecibir = todosLosPedidos.find(p => p.id === pedidoId);
                abrirModalDeRecepcion([lineaARecibir]); // Pasamos la línea dentro de un array
                return;
            }
        });
        
        // Listener para la barra de acciones en lote
        document.getElementById('bulk-action-bar').addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            if (!button || button.disabled) return;
            
            // --- Lógica separada para cada botón ---

            if (button.id === 'bulk-recibir') {
                const lineasARecibir = todosLosPedidos.filter(p => lineasSeleccionadas.has(p.id));
                abrirModalDeRecepcion(lineasARecibir);
            
            } else if (button.id === 'bulk-enviar') {
                const nuevoEstado = 'Enviado a Obra';
                if (!confirm(`¿Confirmas que quieres cambiar el estado a "${nuevoEstado}" para ${lineasSeleccionadas.size} líneas?`)) return;

                button.disabled = true;
                button.textContent = 'Procesando...';
                
                const actualizarEstado = functions.httpsCallable('actualizarEstadoPedido');
                const promesas = [];
                lineasSeleccionadas.forEach(pedidoId => {
                    promesas.push(actualizarEstado({ pedidoId, nuevoEstado }));
                });

                try {
                    await Promise.all(promesas);
                    todosLosPedidos.forEach(p => {
                        if (lineasSeleccionadas.has(p.id)) {
                            p.pedido.estado = nuevoEstado;
                        }
                    });
                    lineasSeleccionadas.clear();
                    actualizarBarraAcciones();
                    renderizarTabla();
                } catch (error) {
                    console.error("Error en acción por lote 'enviar':", error);
                    alert(`Error: ${error.message}`);
                    // Reactivamos el botón si hay un error
                    button.disabled = false;
                    button.textContent = 'Enviar en Lote';
                }
            }
        });
        
        // Listeners específicos del rol de Admin
        if (esAdmin) {
            // Listener para el icono de búsqueda en móvil
            document.getElementById('toggle-search-btn').addEventListener('click', () => {
                const searchInput = document.getElementById('search-input');
                searchInput.classList.toggle('mobile-hidden');
                searchInput.classList.toggle('mobile-visible');
                if (searchInput.classList.contains('mobile-visible')) {
                    searchInput.focus();
                }
            });

            // Listener para el icono de filtro de directos
            document.getElementById('filtro-directos-btn').addEventListener('click', (e) => {
                const button = e.currentTarget;
                const icon = button.querySelector('span');
                mostrarPedidosDirectos = !mostrarPedidosDirectos;
                button.classList.toggle('active', mostrarPedidosDirectos);
                icon.textContent = mostrarPedidosDirectos ? 'visibility' : 'visibility_off';
                renderizarTabla();
            });
            
            // Listener para el checkbox de "Seleccionar todo" (Desktop)
            document.getElementById('th-select-all').querySelector('#select-all-checkbox').addEventListener('change', e => {
                const isChecked = e.target.checked;
                const pedidosVisibles = getPedidosFiltrados();
                pedidosVisibles.forEach(p => {
                    if (isChecked) lineasSeleccionadas.add(p.id);
                    else lineasSeleccionadas.delete(p.id);
                });
                renderizarTabla();
                actualizarBarraAcciones();
            });
            
            // Listener para el botón de "Seleccionar todo" (Móvil)
            document.getElementById('select-all-mobile-btn').addEventListener('click', () => {
                const pedidosVisibles = getPedidosFiltrados();
                const todosYaSeleccionados = pedidosVisibles.length > 0 && pedidosVisibles.every(p => lineasSeleccionadas.has(p.id));

                pedidosVisibles.forEach(p => {
                    if (todosYaSeleccionados) {
                        lineasSeleccionadas.delete(p.id);
                    } else {
                        lineasSeleccionadas.add(p.id);
                    }
                });
                renderizarTabla();
                actualizarBarraAcciones();
            });
        } else {
            // ARREGLO DEL BUG: Listener para el checkbox del usuario normal
            document.getElementById('filtro-mios').addEventListener('change', e => {
                soloMisPedidos = e.target.checked;
                renderizarTabla();
            });
        }
    } catch (error) {
        console.error("Error al cargar los pedidos:", error);
    }
};

const mostrarVistaNuevoPedido = () => {
    // --- Variables de estado ---
    let pedidoActual = [];
    let indiceEditando = null;
    let marcasDeAlmacen = [];
    let productosDeMarcaActual = [];
    let modoCantidadManual = false; // <-- NUEVO ESTADO para controlar el modo
    let proveedoresCargados = []; // <-- NUEVO: Caché para todos los proveedores
    let datosPrecioActual = {}; // NUEVO: para guardar los precios extra

    // --- Estructura HTML ---
    const content = `
        <h2>Crear Nuevo Pedido</h2>
        <div class="form-container">
            <section class="form-section">
                <h3>Añadir Producto</h3>
                <div class="form-grid">
                    <div class="form-field"><label for="expediente">Expediente</label><input type="text" id="expediente" list="expedientes-list"><datalist id="expedientes-list"></datalist></div>
                    <div class="form-field"><label for="proveedor">Proveedor</label><input type="text" id="proveedor" list="proveedores-list"><datalist id="proveedores-list"></datalist></div>
                    <div class="form-field"><label for="marca">Marca</label><input type="text" id="marca" list="marcas-list"><datalist id="marcas-list"></datalist></div>
                    <div class="form-field"><label for="codigo-producto">Código de producto</label><input type="text" id="codigo-producto" list="productos-list"><datalist id="productos-list"></datalist></div>
                    <div class="form-field"><label for="descripcion-producto">Descripción</label><input type="text" id="descripcion-producto"></div>
                    <div class="form-field">
                        <label for="referencia-especifica">Referencia Específica (ej: BAÑO)</label>
                        <input type="text" id="referencia-especifica" placeholder="Opcional...">
                    </div>
                    <div class="form-field"><label for="fecha-entrega">Fecha de entrega requerida</label><input type="date" id="fecha-entrega"></div>
                    <div class="form-field"><label for="unidad-compra">Unidad de Compra</label><select id="unidad-compra"></select></div>
                    
                    <div class="form-field" id="bultos-field-container">
                        <label for="bultos">Bultos</label><input type="number" id="bultos" value="1" min="0">
                    </div>

                    <div class="form-field">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <label for="cantidad">Cantidad</label>
                            <button id="toggle-cantidad-mode" class="icon-button" title="Introducir cantidad manual">
                                <span class="material-symbols-outlined">edit</span>
                            </button>
                        </div>
                        <input type="number" id="cantidad" placeholder="Se calcula..." readonly>
                    </div>

                    <div class="form-field"><label for="precio-producto">Precio Venta</label><input type="number" step="0.01" id="precio-producto" placeholder="Se calcula..."></div>
                    <div class="form-field" style="grid-column: 1 / -1;"><label for="observaciones">Observaciones</label><input type="text" id="observaciones" placeholder="Opcional..."></div>
                    <div class="form-field" id="necesita-almacen-container" style="display: none; align-items: center; flex-direction: row; gap: 10px;">
                        <input type="checkbox" id="necesita-almacen" style="width: auto;"><label for="necesita-almacen" style="margin-bottom: 0;">¿Necesita pasar por almacén?</label>
                    </div>
                </div>
                <div id="price-info-panel" style="margin-top: 15px; padding: 10px; background-color: #f4f6f8; border-radius: 5px; font-size: 14px; display: none;"></div>
                <button id="add-line-btn" style="margin-top: 20px; width: 100%; padding: 15px; font-size: 18px;">Añadir al Pedido</button>
            </section>
            <section class="cart-section">
                <h3>Pedido Actual</h3>
                <div id="pedido-actual-container"><p>Aún no has añadido ningún producto.</p></div>
            </section>
        </div>
    `;
    appContainer.innerHTML = content;

    // --- Referencias a los elementos del DOM ---
    const form = {
        expediente: document.getElementById('expediente'),
        proveedor: document.getElementById('proveedor'),
        marca: document.getElementById('marca'),
        codigo: document.getElementById('codigo-producto'),
        descripcion: document.getElementById('descripcion-producto'),
        referenciaEspecifica: document.getElementById('referencia-especifica'),
        fechaEntrega: document.getElementById('fecha-entrega'),
        unidadCompra: document.getElementById('unidad-compra'),
        bultosContainer: document.getElementById('bultos-field-container'),
        bultos: document.getElementById('bultos'),
        cantidad: document.getElementById('cantidad'),
        precio: document.getElementById('precio-producto'),
        observaciones: document.getElementById('observaciones'),
        necesitaAlmacenContainer: document.getElementById('necesita-almacen-container'),
        necesitaAlmacen: document.getElementById('necesita-almacen'),
        priceInfoPanel: document.getElementById('price-info-panel'),
        addBtn: document.getElementById('add-line-btn')
    };

    const actualizarModoCantidadUI = () => {
        const cantidadInput = document.getElementById('cantidad');
        const bultosContainer = document.getElementById('bultos-field-container');
        const toggleBtn = document.getElementById('toggle-cantidad-mode');

        if (modoCantidadManual) {
            // MODO MANUAL: Cantidad editable, Bultos oculto
            cantidadInput.readOnly = false;
            bultosContainer.style.display = 'none';
            toggleBtn.innerHTML = `<span class="material-symbols-outlined">calculate</span>`;
            toggleBtn.title = 'Calcular por bultos';
        } else {
            // MODO BULTOS: Cantidad solo lectura, Bultos visible
            cantidadInput.readOnly = true;
            bultosContainer.style.display = 'block';
            toggleBtn.innerHTML = `<span class="material-symbols-outlined">edit</span>`;
            toggleBtn.title = 'Introducir cantidad manual';
            // Recalculamos por si acaso
            document.getElementById('bultos').dispatchEvent(new Event('input'));
        }
    };    

    // --- Función para renderizar la tabla del "carrito" ---
    const renderizarPedidoActual = () => {
        const container = document.getElementById('pedido-actual-container');
        if (pedidoActual.length === 0) {
            container.innerHTML = '<p>Aún no has añadido ningún producto.</p>';
            return;
        }

        const filas = pedidoActual.map((linea, index) => {
            const obsIcon = linea.observaciones
                ? `<span class="material-symbols-outlined" title="${linea.observaciones}">comment</span>`
                : `<span class="material-symbols-outlined" style="color: #ccc;" title="Añadir comentario">add_comment</span>`;
            return `
            <tr>
                <td data-label="Producto">${linea.descripcion} (${linea.codigo})</td>
                <td data-label="Proveedor">${linea.proveedor}</td>
                <td data-label="Cantidad">${linea.cantidad} ${linea.unidadVenta}</td>
                <td data-label="Almacén?">${linea.necesitaAlmacen ? 'Sí' : 'No'}</td>
                <td data-label="Obs." class="comment-cell" data-index="${index}">${obsIcon}</td>
                <td data-label="Acciones">
                    <button class="icon-button btn-edit" data-index="${index}" title="Editar línea"><span class="material-symbols-outlined">edit</span></button>
                    <button class="icon-button btn-delete" data-index="${index}" title="Eliminar línea"><span class="material-symbols-outlined">delete</span></button>
                </td>
            </tr>
        `}).join('');

        container.innerHTML = `
            <table>
                <thead>
                    <tr><th>Producto</th><th>Proveedor</th><th>Cant.</th><th>Almacén?</th><th>Obs.</th><th>Acciones</th></tr>
                </thead>
                <tbody>${filas}</tbody>
            </table>
            <button id="finalizar-pedido-btn" style="width:100%; margin-top: 20px;">Finalizar y Enviar Pedidos</button>
        `;

        // --- ¡NUEVA LÓGICA AQUÍ! ---
        // Le damos vida al botón que acabamos de crear
        const finalizarBtn = document.getElementById('finalizar-pedido-btn');
        finalizarBtn.onclick = () => {
            if (!confirm('¿Estás seguro de que quieres finalizar y enviar este pedido?')) {
                return;
            }

            finalizarBtn.disabled = true;
            finalizarBtn.textContent = 'Guardando...';

            const finalizarPedidoFunction = functions.httpsCallable('finalizarPedido');
            finalizarPedidoFunction({ lineas: pedidoActual })
                .then(result => {
                    alert('¡Éxito! El pedido ha sido guardado correctamente.');
                    pedidoActual = []; // Vaciamos el carrito
                    mostrarVista('pedidos'); // Navegamos a la lista de pedidos
                })
                .catch(error => {
                    console.error("Error al finalizar el pedido:", error);
                    alert(`Error: ${error.message}`);
                    finalizarBtn.disabled = false;
                    finalizarBtn.textContent = 'Finalizar y Enviar Pedidos';
                });
        };
    };

    // --- Función para limpiar y resetear el formulario ---
    const resetForm = () => {
        form.marca.value = '';
        form.codigo.value = '';
        form.descripcion.value = '';
        form.referenciaEspecifica.value = '';
        form.precio.value = '';
        form.bultos.value = 1;
        form.cantidad.value = '';
        form.observaciones.value = '';
        form.priceInfoPanel.style.display = 'none';
        indiceEditando = null;
        form.addBtn.textContent = 'Añadir al Pedido';
        form.marca.focus();
    };

    // --- Función para añadir una línea al "carrito" ---
    const añadirLineaAlPedido = () => {
        const proveedorSeleccionado = document.getElementById('proveedor').value;
        const necesitaAlmacenCheck = document.getElementById('necesita-almacen').checked;
        const codigoSeleccionado = form.codigo.value;
        const productoSeleccionado = productosDeMarcaActual.find(p => p.codigo === codigoSeleccionado);        

        const linea = {
            expediente: form.expediente.value,
            direccion: direccionExpedienteSeleccionado,
            proveedor: proveedorSeleccionado,
            marca: form.marca.value,
            codigo: form.codigo.value,
            descripcion: form.descripcion.value,
            fechaEntrega: form.fechaEntrega.value,
            bultos: parseFloat(form.bultos.value) || 0,
            cantidad: parseFloat(form.cantidad.value).toFixed(2) || 0,
            udBulto: (productoSeleccionado ? productoSeleccionado.udBulto : 1),
            precio: parseFloat(form.precio.value) || 0,
            unidadVenta: form.unidadCompra.value,
            observaciones: form.observaciones.value,
            necesitaAlmacen: proveedorSeleccionado === 'ACE DISTRIBUCION' ? true : form.necesitaAlmacen.checked,
            referenciaEspecifica: form.referenciaEspecifica.value, // Añadimos la nueva referencia
            precioPVP: datosPrecioActual.pvp || 0, // Añadimos el PVP
            dtoPresupuesto: datosPrecioActual.dto || 0 // Añadimos el descuento            
        };

        if (!linea.expediente || !linea.proveedor || !linea.codigo || !linea.cantidad || !linea.fechaEntrega) {
            alert('Por favor, completa los campos obligatorios (Expediente, Proveedor, Código, Cantidad y Fecha de Entrega).');
            return;
        }

        if (indiceEditando !== null) {
            // Estamos guardando una edición
            pedidoActual[indiceEditando] = linea;
        } else {
            // Estamos añadiendo una nueva línea
            pedidoActual.push(linea);
        }
        renderizarPedidoActual();
        resetForm();
    };

    // --- Lógica de Carga de Datos Iniciales ---
    db.collection('expedientes').orderBy('expediente').get().then(snap => { document.getElementById('expedientes-list').innerHTML = snap.docs.map(doc => `<option value="${doc.data().expediente}">${doc.data().direccion}</option>`).join(''); });
    db.collection('proveedores').where('tipo', '==', 'Material').orderBy('nombreFiscal').get().then(snap => {
        proveedoresCargados = snap.docs.map(doc => doc.data());
        console.log(`Cargados ${proveedoresCargados.length} proveedores en caché.`);
        // YA NO rellenamos el datalist aquí para evitar la sobrecarga.
    });
    db.collection('marcas').get().then(snap => { marcasDeAlmacen = snap.docs.map(doc => doc.data()); });

    // --- Asignación de Eventos ---

    const proveedorInput = document.getElementById('proveedor');
    const marcaInput = document.getElementById('marca');
    const codigoProductoInput = document.getElementById('codigo-producto');
    const bultosInput = document.getElementById('bultos');
    const necesitaAlmacenContainer = document.getElementById('necesita-almacen-container');
    const descripcionInput = document.getElementById('descripcion-producto');
    form.addBtn.onclick = añadirLineaAlPedido;

    proveedorInput.addEventListener('input', e => {
        const valorActual = e.target.value;
        const proveedoresDatalist = document.getElementById('proveedores-list');    
        const proveedorSeleccionado = e.target.value;
        const bultosContainer = document.getElementById('bultos-field-container');
        const cantidadInput = document.getElementById('cantidad');
        const precioInput = document.getElementById('precio-producto');
        const unidadCompraSelect = document.getElementById('unidad-compra');
        marcaInput.value = '';
        codigoProductoInput.value = '';
        document.getElementById('descripcion-producto').value = '';
        document.getElementById('precio-producto').value = '';
        // --- Lógica de filtrado dinámico para el datalist (Solución al rendimiento) ---
        if (valorActual.length < 2) { // Empezamos a buscar a partir de 2 caracteres
            proveedoresDatalist.innerHTML = '';
        } else {
            const filtrados = proveedoresCargados
                .filter(p => p.nombreFiscal.toLowerCase().includes(valorActual.toLowerCase()))
                .slice(0, 20); // Mostramos solo los primeros 20 para no saturar
            
            proveedoresDatalist.innerHTML = filtrados.map(p => `<option value="${p.nombreFiscal}">CIF: ${p.cif || 'N/A'}</option>`).join('');
        }    
        productosDeMarcaActual = [];
        if (proveedorSeleccionado === 'ACE DISTRIBUCION') {
            bultosContainer.style.display = 'block';
            cantidadInput.readOnly = true;
            precioInput.readOnly = true;
            unidadCompraSelect.innerHTML = '<option value="">Selecciona un producto</option>'; // Se rellena al elegir producto            
            marcaInput.placeholder = 'Selecciona una marca de almacén';
            descripcionInput.placeholder = 'Se rellena automáticamente...';
            document.getElementById('marcas-list').innerHTML = marcasDeAlmacen.map(m => `<option value="${m.nombre}"></option>`).join('');
            necesitaAlmacenContainer.style.display = 'none';
        } else {
            bultosContainer.style.display = 'none'; // Ocultamos bultos
            cantidadInput.readOnly = false; // Hacemos editable
            precioInput.readOnly = false;   // Hacemos editable
            // Rellenamos el select de unidad con las opciones fijas
            unidadCompraSelect.innerHTML = `
                <option value="ud">ud</option>
                <option value="m">m</option>
                <option value="m²">m²</option>
                <option value="pz">pz</option>
            `;            
            marcaInput.placeholder = 'Escribe la marca del producto';
            descripcionInput.placeholder = 'Escribe el nombre del producto';
            document.getElementById('marcas-list').innerHTML = '';
            necesitaAlmacenContainer.style.display = 'flex';
        }
    });

    marcaInput.addEventListener('input', e => {
        const marcaSeleccionada = e.target.value;
        const marcaEncontrada = marcasDeAlmacen.find(m => m.nombre === marcaSeleccionada);
        codigoProductoInput.value = '';
        document.getElementById('descripcion-producto').value = '';
        document.getElementById('precio-producto').value = '';
        productosDeMarcaActual = [];
        document.getElementById('productos-list').innerHTML = '';
        if (marcaEncontrada) {
            codigoProductoInput.placeholder = 'Cargando productos...';
            codigoProductoInput.disabled = true;
            const getProductos = functions.httpsCallable('getProductosPorMarca');
            getProductos({ sheetId: marcaEncontrada.idHoja })
                .then(result => {
                    productosDeMarcaActual = result.data.productos;
                    document.getElementById('productos-list').innerHTML = productosDeMarcaActual.map(p => `<option value="${p.codigo}">${p.descripcion}</option>`).join('');
                    codigoProductoInput.placeholder = 'Selecciona un producto';
                    codigoProductoInput.disabled = false;
                })
                .catch(error => {
                    console.error("Error al llamar a la Cloud Function:", error);
                    alert(`Error: ${error.message}`);
                    codigoProductoInput.placeholder = 'Error al cargar';
                    codigoProductoInput.disabled = false;
                });
        } else {
            codigoProductoInput.placeholder = 'Escribe el código';
            codigoProductoInput.disabled = false;
        }
    });

    codigoProductoInput.addEventListener('input', e => {
        const codigoSeleccionado = e.target.value;
        const productoEncontrado = productosDeMarcaActual.find(p => p.codigo === codigoSeleccionado);
        const marcaSeleccionada = marcasDeAlmacen.find(m => m.nombre === marcaInput.value);
        const precioInput = document.getElementById('precio-producto');
        const descripcionInput = document.getElementById('descripcion-producto');
        const priceInfoPanel = document.getElementById('price-info-panel');
        const unidadCompraSelect = document.getElementById('unidad-compra');
        priceInfoPanel.style.display = 'none';
        precioInput.readOnly = true;

        if (productoEncontrado && marcaSeleccionada) {
            descripcionInput.value = productoEncontrado.descripcion;
            const precioBase = productoEncontrado.precio;
            const precioVenta = precioBase * marcaSeleccionada.multiplicadorPV;
            const precioPVP = precioBase * marcaSeleccionada.multiplicadorPVP;
            const dtoPresupuesto = marcaSeleccionada.dtoPresupuesto / 100; // Corregido
            const costePresupuesto = precioPVP * (1 - dtoPresupuesto);
            precioInput.value = precioVenta.toFixed(2);
            priceInfoPanel.innerHTML = `<strong>Info Adicional:</strong><br>PVP: ${precioPVP.toFixed(2)} € | Descuento Presupuesto: ${(dtoPresupuesto * 100).toFixed(0)}% <br>Coste para Presupuesto: ${costePresupuesto.toFixed(2)} €`;
            priceInfoPanel.style.display = 'block';
            bultosInput.dispatchEvent(new Event('input')); // Recalcular cantidad al elegir producto
            unidadCompraSelect.innerHTML = `<option value="${productoEncontrado.unidadVenta}">${productoEncontrado.unidadVenta}</option>`;
            datosPrecioActual = {
                pvp: precioPVP.toFixed(2),
                dto: dtoPresupuesto
            };            
            modoCantidadManual = false; // Volvemos al modo bultos por defecto
            actualizarModoCantidadUI(); // Actualizamos la UI
        } else {
            precioInput.readOnly = false;
            precioInput.placeholder = 'Introduce el precio';
        }
    });

    document.getElementById('toggle-cantidad-mode').addEventListener('click', (e) => {
        e.preventDefault(); // Prevenimos que el formulario se envíe
        modoCantidadManual = !modoCantidadManual; // Invertimos el modo
        actualizarModoCantidadUI(); // Actualizamos la interfaz
    });

    bultosInput.addEventListener('input', (e) => {
        if (modoCantidadManual) return; // Si estamos en modo manual, no hacemos nada

        const bultos = parseFloat(e.target.value) || 0;
        const producto = productosDeMarcaActual.find(p => p.codigo === document.getElementById('codigo-producto').value);
        const udBulto = producto ? producto.udBulto : 1;
        document.getElementById('cantidad').value = (bultos * udBulto).toFixed(2);
    });

    document.getElementById('expediente').addEventListener('input', e => {
        const opcionSeleccionada = document.querySelector(`#expedientes-list option[value="${e.target.value}"]`);
        if (opcionSeleccionada) {
            direccionExpedienteSeleccionado = opcionSeleccionada.textContent;
        } else {
            direccionExpedienteSeleccionado = '';
        }
    });

        // Listener único para la tabla del carrito (Delegación de Eventos)
    document.getElementById('pedido-actual-container').addEventListener('click', e => {
        const target = e.target.closest('button, .comment-cell');
        if (!target) return;

        const index = parseInt(target.dataset.index);

        if (target.classList.contains('btn-delete')) {
            if (confirm('¿Estás seguro de que quieres eliminar esta línea?')) {
                pedidoActual.splice(index, 1);
                renderizarPedidoActual();
            }
        } else if (target.classList.contains('btn-edit')) {
            const lineaAEditar = pedidoActual[index];
            // Rellenar el formulario con los datos de la línea
            for (const key in lineaAEditar) {
                if (form[key]) {
                    form[key].value = lineaAEditar[key];
                }
            }
            form.addBtn.textContent = 'Guardar Cambios';
            indiceEditando = index;
            window.scrollTo(0,0); // Subir al principio de la página
        } else if (target.classList.contains('comment-cell')) {
            const linea = pedidoActual[index];
            const comentarioActual = linea.observaciones || "";
            const nuevoComentario = prompt("Observaciones:", comentarioActual);

            if (nuevoComentario !== null) { // Si el usuario no pulsa "Cancelar"
                pedidoActual[index].observaciones = nuevoComentario;
                renderizarPedidoActual();
            }
        }
    });
};

const mostrarVistaSalidaRapida = async () => {
    // --- Variables de estado para esta vista ---
    let productosHabitualesDetallados = [];
    let salidaActual = []; // El "carrito" para esta salida
    let filtroBusqueda = '';

    // --- Estructura HTML (añadimos el contenedor del carrito y el botón de finalizar) ---
    const content = `
        <div class="form-container">
            <section class="form-section">
                <h3>Registrar Salida Rápida</h3>
            <div id="vista-opciones" class="vista-opciones-grid">
                <input type="text" id="expediente-salida" list="expedientes-list-salida" placeholder="* Expediente de destino OBLIGATORIO">
                <datalist id="expedientes-list-salida"></datalist>

                <input type="search" id="search-productos-habituales" placeholder="🔍 Filtrar productos...">
            </div>
                <div id="product-grid-container" class="product-grid">
                    <p>Cargando productos...</p>
                </div>
            </section>
            <section class="cart-section">
                <h3>Productos para Salida</h3>
                <div id="salida-actual-container"><p>Añade productos desde el catálogo.</p></div>
                <button id="finalizar-salida-btn" style="width:100%; margin-top: 20px;" disabled>Registrar Salida</button>
            </section>
        </div>
    `;
    appContainer.innerHTML = content;

    // --- Referencias al DOM ---
    const gridContainer = document.getElementById('product-grid-container');
    const searchInput = document.getElementById('search-productos-habituales');
    const expedienteInput = document.getElementById('expediente-salida');
    const finalizarBtn = document.getElementById('finalizar-salida-btn');
    const salidaContainer = document.getElementById('salida-actual-container');

    // --- Funciones auxiliares ---

    // Función para normalizar texto (quitar tildes y a minúsculas)
    const normalizarTexto = (texto) => {
        return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    };
    
    // Función para renderizar el "carrito" de salida
    const renderizarSalidaActual = () => {
        finalizarBtn.disabled = salidaActual.length === 0 || !expedienteInput.value;
        if (salidaActual.length === 0) {
            salidaContainer.innerHTML = '<p>Añade productos desde el catálogo.</p>';
            return;
        }

        // Agrupamos los productos por expediente
        const agrupados = salidaActual.reduce((acc, item) => {
            (acc[item.expediente] = acc[item.expediente] || []).push(item);
            return acc;
        }, {});

        let html = '';
        for (const expediente in agrupados) {
            html += `<h4 style="background-color: #eee; padding: 5px;">Exp: ${expediente}</h4>`;
            html += `<table><tbody>`;
            agrupados[expediente].forEach((item, index) => {
                // Usamos el índice original para poder borrarlo del array plano
                const originalIndex = salidaActual.findIndex(p => p === item);
                html += `
                    <tr>
                        <td>${item.descripcion}</td>
                        <td>${item.cantidad} ${item.unidadVenta}</td>
                        <td><button class="icon-button btn-delete-salida" data-index="${originalIndex}"><span class="material-symbols-outlined">delete</span></button></td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
        }
        salidaContainer.innerHTML = html;
    };

    // --- Función para renderizar las tarjetas de producto ---
    const renderizarGrid = () => {
        const productosFiltrados = productosHabitualesDetallados.filter(p => {
            const busquedaLower = filtroBusqueda.toLowerCase();
            return p.descripcion.toLowerCase().includes(busquedaLower) || 
                   p.codigo.toLowerCase().includes(busquedaLower) ||
                   p.marca.toLowerCase().includes(busquedaLower);
        });

        if (productosFiltrados.length === 0) {
            gridContainer.innerHTML = '<p>No se encontraron productos que coincidan con la búsqueda.</p>';
            return;
        }

        gridContainer.innerHTML = productosFiltrados.map(p => `
            <div class="product-card" data-codigo="${p.codigo}">
                <img src="${p.imagenUrl || 'https://via.placeholder.com/150'}" alt="${p.descripcion}">
                <div class="product-info">
                    <h4>${p.codigo}</h4>
                    <p>${p.descripcion}</p>
                </div>
            </div>
        `).join('');
    };

    // --- Lógica Principal ---
    try {
        db.collection('expedientes').orderBy('expediente').get().then(snap => {
            document.getElementById('expedientes-list-salida').innerHTML = snap.docs.map(doc => `<option value="${doc.data().expediente}">${doc.data().direccion}</option>`).join('');
        });
        const getHabituales = functions.httpsCallable('getHabitualesConDetalles');
        const result = await getHabituales();
        productosHabitualesDetallados = result.data.productos;
        renderizarGrid();
        renderizarSalidaActual();

        // --- Asignación de Event Listeners ---
        searchInput.addEventListener('input', e => { filtroBusqueda = e.target.value; renderizarGrid(); });
        expedienteInput.addEventListener('input', () => { finalizarBtn.disabled = salidaActual.length === 0 || !expedienteInput.value; });

        // Listener para hacer clic en una tarjeta de producto
        gridContainer.addEventListener('click', e => {
            const card = e.target.closest('.product-card');
            if (!card) return;

            const expedienteSeleccionado = expedienteInput.value;
            if (!expedienteSeleccionado) {
                alert('Por favor, selecciona primero un expediente de destino.');
                expedienteInput.focus();
                return;
            }

            const codigoProducto = card.dataset.codigo;
            const producto = productosHabitualesDetallados.find(p => p.codigo === codigoProducto);
            
            // Abrimos el modal para pedir la cantidad
            const modalOverlay = document.createElement('div');
            modalOverlay.className = 'modal-overlay';
            modalOverlay.innerHTML = `
                <div class="modal-content">
                    <h3>${producto.descripcion}</h3>
                    <p>Introduce la cantidad a retirar:</p>
                    <div class="input-group">
                        <input type="number" id="cantidad-modal" inputmode="decimal" pattern="[0-9]*" autofocus>
                        <span class="unit-label">${producto.unidadVenta}</span>
                    </div>
                    <div class="modal-buttons">
                        <button id="cancel-modal" class="btn-secondary">Cancelar</button>
                        <button id="ok-modal">Aceptar</button>
                    </div>
                </div>`;
            document.body.appendChild(modalOverlay);
            document.getElementById('cantidad-modal').focus();

            // Listeners del modal
            document.getElementById('ok-modal').onclick = () => {
                const cantidad = parseFloat(document.getElementById('cantidad-modal').value);
                if (cantidad > 0) {
                    salidaActual.push({ ...producto, cantidad, expediente: expedienteSeleccionado });
                    renderizarSalidaActual();
                }
                document.body.removeChild(modalOverlay);
            };
            document.getElementById('cancel-modal').onclick = () => document.body.removeChild(modalOverlay);
        });

        // Listener para borrar líneas del carrito de salida
        salidaContainer.addEventListener('click', e => {
            const deleteBtn = e.target.closest('.btn-delete-salida');
            if (deleteBtn) {
                salidaActual.splice(deleteBtn.dataset.index, 1);
                renderizarSalidaActual();
            }
        });

        // Listener para el botón de finalizar
        finalizarBtn.addEventListener('click', async () => {
            if (salidaActual.length === 0 || !expedienteInput.value) {
                alert('Debes tener al menos un producto en la lista y un expediente seleccionado.');
                return;
            }

            if (!confirm(`¿Estás seguro de que quieres registrar la salida de ${salidaActual.length} producto(s)?`)) {
                return;
            }

            finalizarBtn.disabled = true;
            finalizarBtn.textContent = 'Registrando...';

            try {
                const registrarSalida = functions.httpsCallable('registrarSalidaRapida');
                await registrarSalida({ lineasSalida: salidaActual });

                alert('¡Éxito! La salida ha sido registrada correctamente.');
                mostrarVista('pedidos'); // Navegamos a la lista de pedidos

            } catch (error) {
                console.error("Error al finalizar la salida rápida:", error);
                alert(`Error: ${error.message}`);
                finalizarBtn.disabled = false;
                finalizarBtn.textContent = 'Registrar Salida';
            }
        });

    } catch (error) {
        console.error("Error al cargar productos habituales:", error);
        gridContainer.innerHTML = `<p style="color: red;">Error al cargar los productos. Revisa la consola.</p>`;
    }
};

const mostrarLogin = () => {
    appContainer.innerHTML = `
        <div style="text-align:center; padding: 50px;">
            <h2>Bienvenido</h2>
            <p>Por favor, inicia sesión para gestionar los pedidos.</p>
        </div>
    `;
    // Ocultamos la navegación principal si no está logueado
    document.getElementById('main-nav').style.display = 'none';
};

// --- Observador del estado de autenticación ---
auth.onAuthStateChanged(async (user) => {
    if (user) {
        // Obtenemos la lista de administradores
        const adminConfig = await db.collection('config').doc('usuariosAdmin').get();
        const adminEmails = adminConfig.exists ? adminConfig.data().emails : [];
        const esAdmin = adminEmails.includes(user.email);

        // Muestra u oculta los elementos solo para administradores
        document.querySelectorAll('.admin-only').forEach(elem => {
            // Usamos 'inline-block' para que los enlaces <a> se comporten bien
            elem.style.display = esAdmin ? 'inline-block' : 'none';
        });

        // Usuario está logueado
        document.getElementById('main-nav').style.display = 'flex'; // Mostramos la nav
        authControls.innerHTML = `
            <div class="user-info">
                <strong>${user.displayName}</strong>
                <span>${user.email}</span>
            </div>
            <button id="logout-btn">Cerrar sesión</button>
        `;
        document.getElementById('logout-btn').onclick = () => auth.signOut();
        
        // Cargar la vista por defecto (lista de pedidos)
        mostrarVista('pedidos');

    } else {
        // Usuario no está logueado
        authControls.innerHTML = '<button id="login-btn">Iniciar sesión con Google</button>';
        document.getElementById('login-btn').onclick = () => auth.signInWithPopup(provider);
        
        // Mostramos la pantalla de login
        mostrarLogin();
    }
});

// --- Event Listeners para la Navegación ---
navPedidos.onclick = (e) => { e.preventDefault(); mostrarVista('pedidos'); };
navNuevo.onclick = (e) => { e.preventDefault(); mostrarVista('nuevo'); };
navSalidaRapida.onclick = (e) => { e.preventDefault(); mostrarVista('salida-rapida'); };
