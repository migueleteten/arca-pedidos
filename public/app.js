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

// --- Router de Vistas ---
const mostrarVista = (vista) => {
    appContainer.innerHTML = ''; // Limpiamos el contenedor principal
    navPedidos.classList.remove('active');
    navNuevo.classList.remove('active');

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
    }
};

// --- Funciones para Renderizar cada Vista ---

const mostrarVistaPedidos = () => {
    const content = `
        <h2>Mis Pedidos</h2>
        <div id="pedidos-container">
            <table>
                <thead>
                    <tr>
                        <th>Expediente</th>
                        <th>Proveedor</th>
                        <th>Marca</th>
                        <th>Producto</th>
                        <th>Cantidad</th>
                        <th>Estado</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody id="pedidos-tbody">
                    <tr>
                        <td colspan="7" style="text-align:center; padding: 20px;">
                            Aún no has realizado ningún pedido.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
    appContainer.innerHTML = content;
};

const mostrarVistaNuevoPedido = () => {
    // --- Variables de estado para esta vista ---
    let pedidoActual = []; // El "carrito" con las líneas de pedido
    let indiceEditando = null;
    let marcasDeAlmacen = []; // Caché de las marcas de almacén
    let productosDeMarcaActual = []; // Caché de los productos de la marca seleccionada

    // --- Estructura HTML Completa de la Vista ---
    const content = `
        <h2>Crear Nuevo Pedido</h2>
        <div class="form-container">
            <section class="form-section">
                <h3>Añadir Producto</h3>
                <div class="form-grid">
                    <div class="form-field"><label for="expediente">Expediente</label><input type="text" id="expediente" list="expedientes-list" placeholder="Escribe para buscar..."><datalist id="expedientes-list"></datalist></div>
                    <div class="form-field"><label for="proveedor">Proveedor</label><input type="text" id="proveedor" list="proveedores-list" placeholder="Escribe para buscar..."><datalist id="proveedores-list"></datalist></div>
                    <div class="form-field"><label for="marca">Marca</label><input type="text" id="marca" list="marcas-list" placeholder="Selecciona primero un proveedor..."><datalist id="marcas-list"></datalist></div>
                    <div class="form-field"><label for="codigo-producto">Código de producto</label><input type="text" id="codigo-producto" list="productos-list" placeholder="Selecciona una marca..."><datalist id="productos-list"></datalist></div>
                    <div class="form-field"><label for="descripcion-producto">Descripción</label><input type="text" id="descripcion-producto" placeholder="Se rellena automáticamente..."></div>
                    <div class="form-field"><label for="fecha-entrega">Fecha de entrega requerida</label><input type="date" id="fecha-entrega"></div>
                    
                    <div class="form-field">
                        <label for="unidad-compra">Unidad de Compra</label>
                        <select id="unidad-compra"></select>
                    </div>

                    <div class="form-field" id="bultos-field-container">
                        <label for="bultos">Bultos</label><input type="number" id="bultos" value="1" min="0">
                    </div>

                    <div class="form-field"><label for="cantidad">Cantidad</label><input type="number" id="cantidad" placeholder="Se calcula..."></div>
                    <div class="form-field"><label for="precio-producto">Precio Compra Neto</label><input type="number" step="0.01" id="precio-producto" placeholder="Se calcula..."></div>
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
                : `<span class="material-symbols-outlined" style="color: #ccc;">add_comment</span>`;

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
    };

    // --- Función para limpiar y resetear el formulario ---
    const resetForm = () => {
        form.marca.value = '';
        form.codigo.value = '';
        form.descripcion.value = '';
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

        const linea = {
            expediente: form.expediente.value,
            proveedor: proveedorSeleccionado,
            marca: form.marca.value,
            codigo: form.codigo.value,
            descripcion: form.descripcion.value,
            fechaEntrega: form.fechaEntrega.value,
            bultos: parseFloat(form.bultos.value) || 0,
            cantidad: parseFloat(form.cantidad.value) || 0,
            precio: parseFloat(form.precio.value) || 0,
            unidadVenta: form.unidadCompra.value,
            observaciones: form.observaciones.value,
            necesitaAlmacen: proveedorSeleccionado === 'ACE DISTRIBUCIÓN' ? true : form.necesitaAlmacen.checked
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
    db.collection('proveedores').where('tipo', '==', 'Material').orderBy('nombreComercial').get().then(snap => { document.getElementById('proveedores-list').innerHTML = snap.docs.map(doc => `<option value="${doc.data().nombreComercial}">CIF: ${doc.data().cif || 'N/A'}</option>`).join(''); });
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
        const proveedorSeleccionado = e.target.value;
        const bultosContainer = document.getElementById('bultos-field-container');
        const cantidadInput = document.getElementById('cantidad');
        const precioInput = document.getElementById('precio-producto');
        const unidadCompraSelect = document.getElementById('unidad-compra');
        marcaInput.value = '';
        codigoProductoInput.value = '';
        document.getElementById('descripcion-producto').value = '';
        document.getElementById('precio-producto').value = '';
        productosDeMarcaActual = [];
        if (proveedorSeleccionado === 'ACE DISTRIBUCIÓN') {
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
        } else {
            precioInput.readOnly = false;
            precioInput.placeholder = 'Introduce el precio';
        }
    });

    bultosInput.addEventListener('input', () => {
        const bultos = parseFloat(bultosInput.value) || 0;
        const producto = productosDeMarcaActual.find(p => p.codigo === codigoProductoInput.value);
        const udBulto = producto ? producto.udBulto : 1;
        document.getElementById('cantidad').value = bultos * udBulto;
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
auth.onAuthStateChanged(user => {
    if (user) {
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
