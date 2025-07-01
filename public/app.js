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
    let marcasDeAlmacen = []; // Caché de las marcas de almacén
    let productosDeMarcaActual = []; // Caché de los productos de la marca seleccionada

    // --- Estructura HTML Completa de la Vista ---
    const content = `
        <h2>Crear Nuevo Pedido</h2>
        <div class="form-container">
            <section class="form-section">
                <h3>Añadir Producto</h3>
                <div class="form-grid">
                    <div class="form-field"><label for="expediente">Expediente</label><input type="text" id="expediente" list="expedientes-list" placeholder="Escribe para buscar...">
                        <datalist id="expedientes-list"></datalist>
                    </div>
                    <div class="form-field"><label for="proveedor">Proveedor</label><input type="text" id="proveedor" list="proveedores-list" placeholder="Escribe para buscar...">
                        <datalist id="proveedores-list"></datalist>
                    </div>
                    <div class="form-field"><label for="marca">Marca</label><input type="text" id="marca" list="marcas-list" placeholder="Selecciona primero un proveedor...">
                        <datalist id="marcas-list"></datalist>
                    </div>
                    <div class="form-field"><label for="codigo-producto">Código de producto</label><input type="text" id="codigo-producto" list="productos-list" placeholder="Selecciona una marca...">
                        <datalist id="productos-list"></datalist>
                    </div>
                    <div class="form-field"><label for="descripcion-producto">Descripción</label><input type="text" id="descripcion-producto" placeholder="Se rellena automáticamente..."></div>
                    <div class="form-field"><label for="fecha-entrega">Fecha de entrega requerida</label><input type="date" id="fecha-entrega"></div>
                    <div class="form-field"><label for="bultos">Bultos</label><input type="number" id="bultos" value="1" min="0"></div>
                    <div class="form-field"><label for="cantidad">Cantidad</label><input type="number" id="cantidad" placeholder="Se calcula..." readonly></div>
                    <div class="form-field"><label for="precio-producto">Precio Venta</label><input type="number" step="0.01" id="precio-producto" placeholder="Se calcula..." readonly></div>
                    <div class="form-field" style="grid-column: 1 / -1;"><label for="observaciones">Observaciones</label><input type="text" id="observaciones" placeholder="Opcional..."></div>
                    <div class="form-field" id="necesita-almacen-container" style="display: none; align-items: center; flex-direction: row; gap: 10px;">
                        <input type="checkbox" id="necesita-almacen" style="width: auto;">
                        <label for="necesita-almacen" style="margin-bottom: 0;">¿Necesita pasar por almacén?</label>
                    </div>
                </div>
                <div id="price-info-panel" style="margin-top: 15px; padding: 10px; background-color: #f4f6f8; border-radius: 5px; font-size: 14px; display: none;"></div>
                <button id="add-line-btn" style="margin-top: 20px; width: 100%; padding: 15px; font-size: 18px;">Añadir al Pedido</button>
            </section>
            <section class="cart-section">
                <h3>Pedido Actual</h3>
                <div id="pedido-actual-container">
                    <p>Aún no has añadido ningún producto.</p>
                </div>
            </section>
        </div>
    `;
    appContainer.innerHTML = content;

    // --- Función para renderizar la tabla del "carrito" ---
    const renderizarPedidoActual = () => {
        const container = document.getElementById('pedido-actual-container');
        if (pedidoActual.length === 0) {
            container.innerHTML = '<p>Aún no has añadido ningún producto.</p>';
            return;
        }

        const filas = pedidoActual.map((linea, index) => `
            <tr>
                <td data-label="Producto">${linea.descripcion} (${linea.codigo})</td>
                <td data-label="Cantidad">${linea.cantidad}</td>
                <td data-label="Precio">${linea.precio.toFixed(2)} €</td>
                <td data-label="Importe">${(linea.cantidad * linea.precio).toFixed(2)} €</td>
                <td data-label="Acciones">
                    <button class="btn-edit" data-index="${index}">Editar</button>
                    <button class="btn-delete" data-index="${index}">Eliminar</button>
                </td>
            </tr>
        `).join('');

        container.innerHTML = `
            <table>
                <thead>
                    <tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Importe</th><th>Acciones</th></tr>
                </thead>
                <tbody>${filas}</tbody>
            </table>
            <button id="finalizar-pedido-btn" style="width:100%; margin-top: 20px;">Finalizar y Enviar Pedidos</button>
        `;
    };

    // --- Función para añadir una línea al "carrito" ---
    const añadirLineaAlPedido = () => {
        const nuevaLinea = {
            expediente: document.getElementById('expediente').value,
            proveedor: document.getElementById('proveedor').value,
            marca: document.getElementById('marca').value,
            codigo: document.getElementById('codigo-producto').value,
            descripcion: document.getElementById('descripcion-producto').value,
            fechaEntrega: document.getElementById('fecha-entrega').value,
            bultos: parseFloat(document.getElementById('bultos').value) || 0,
            cantidad: parseFloat(document.getElementById('cantidad').value) || 0,
            precio: parseFloat(document.getElementById('precio-producto').value) || 0,
            observaciones: document.getElementById('observaciones').value,
            necesitaAlmacen: document.getElementById('necesita-almacen').checked
        };

        if (!nuevaLinea.expediente || !nuevaLinea.proveedor || !nuevaLinea.codigo || !nuevaLinea.cantidad || !nuevaLinea.fechaEntrega) {
            alert('Por favor, completa los campos obligatorios (Expediente, Proveedor, Código, Cantidad y Fecha de Entrega).');
            return;
        }

        pedidoActual.push(nuevaLinea);
        renderizarPedidoActual();

        document.getElementById('marca').value = '';
        document.getElementById('codigo-producto').value = '';
        document.getElementById('descripcion-producto').value = '';
        document.getElementById('precio-producto').value = '';
        document.getElementById('bultos').value = 1;
        document.getElementById('cantidad').value = '';
        document.getElementById('observaciones').value = '';
        document.getElementById('price-info-panel').style.display = 'none';
        document.getElementById('marca').focus();
    };

    // --- Lógica de Carga de Datos Iniciales ---
    db.collection('expedientes').orderBy('expediente').get().then(snap => { document.getElementById('expedientes-list').innerHTML = snap.docs.map(doc => `<option value="${doc.data().expediente}">${doc.data().direccion}</option>`).join(''); });
    db.collection('proveedores').where('tipo', '==', 'Material').orderBy('nombreComercial').get().then(snap => { document.getElementById('proveedores-list').innerHTML = snap.docs.map(doc => `<option value="${doc.data().nombreComercial}">CIF: ${doc.data().cif || 'N/A'}</option>`).join(''); });
    db.collection('marcas').get().then(snap => { marcasDeAlmacen = snap.docs.map(doc => doc.data()); });

    // --- Asignación de Eventos ---
    document.getElementById('add-line-btn').onclick = añadirLineaAlPedido;

    const proveedorInput = document.getElementById('proveedor');
    const marcaInput = document.getElementById('marca');
    const codigoProductoInput = document.getElementById('codigo-producto');
    const bultosInput = document.getElementById('bultos');
    const necesitaAlmacenContainer = document.getElementById('necesita-almacen-container');

    proveedorInput.addEventListener('input', e => {
        const proveedorSeleccionado = e.target.value;
        marcaInput.value = '';
        codigoProductoInput.value = '';
        document.getElementById('descripcion-producto').value = '';
        document.getElementById('precio-producto').value = '';
        productosDeMarcaActual = [];
        if (proveedorSeleccionado === 'ACE DISTRIBUCIÓN') {
            marcaInput.placeholder = 'Selecciona una marca de almacén';
            document.getElementById('marcas-list').innerHTML = marcasDeAlmacen.map(m => `<option value="${m.nombre}"></option>`).join('');
            necesitaAlmacenContainer.style.display = 'none';
        } else {
            marcaInput.placeholder = 'Escribe la marca del producto';
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
