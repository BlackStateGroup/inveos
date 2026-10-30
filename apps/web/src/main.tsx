import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import RecipientPortal from './RecipientPortal';
import {CollaboratorPortal} from './RestrictedWork';
import './styles.css';
import './casework.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.pathname==='/collaborator'?<CollaboratorPortal/>:location.pathname==='/portal'?<RecipientPortal/>:<App/>}</React.StrictMode>);
