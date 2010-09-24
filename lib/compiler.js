
/*!
 * Jade - Compiler
 * Copyright(c) 2010 TJ Holowaychuk <tj@vision-media.ca>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var nodes = require('./nodes'),
    filters = require('./filters'),
    doctypes = require('./doctypes'),
    selfClosing = require('./self-closing'),
    utils = require('./utils');

/**
 * Initialize `Compiler` with the given `node`.
 *
 * Options:
 *
 *   - `pretty`  prettyify output with proper indentation
 *
 * @param {Node} node
 * @param {Object} options
 * @api public
 */

var Compiler = module.exports = function Compiler(node, options) {
    this.options = options = options || {};
    this.node = node;
    this.pretty = options.pretty;
    this.indents = options.indents || 0;
};

/**
 * Compiler prototype.
 */

Compiler.prototype = {
    
    /**
     * Compile parse tree to JavaScript.
     *
     * @api public
     */
    
    compile: function(){
        this.buf = ['var buf = [];'];
        this.visit(this.node);
        this.buf.push("return buf.join('');");
        return this.buf.join('\n');
    },
    
    /**
     * Buffer the given `str` optionally escaped.
     *
     * @param {String} str
     * @param {Boolean} esc
     * @api public
     */
    
    buffer: function(str, esc){
        if (esc) str = utils.escape(str);
        this.buf.push("buf.push('" + str + "');");
    },
    
    /**
     * Buffer the given `node`'s lineno.
     *
     * @param {Node} node
     * @api public
     */
    
    line: function(node){
        if (node.instrumentLineNumber === false) return;
        this.buf.push('_.lineno = ' + node.line + ';');
    },
    
    /**
     * Visit `node`.
     *
     * @param {Node} node
     * @api public
     */
    
    visit: function(node){
        this.line(node);
        return this.visitNode(node);
    },
    
    /**
     * Visit `node`.
     *
     * @param {Node} node
     * @api public
     */
    
    visitNode: function(node){
        return this['visit' + node.constructor.name](node);
    },
    
    /**
     * Visit all nodes in `block`.
     *
     * @param {Block} block
     * @api public
     */

    visitBlock: function(block){
        ++this.indents;
        for (var i = 0, len = block.length; i < len; ++i) {
            this.visit(block[i]);
        }
        --this.indents;
    },
    
    /**
     * Visit `doctype`. Sets terse mode to `true` when html 5
     * is used, causing self-closing tags to end with ">" vs "/>",
     * and boolean attributes are not mirrored.
     *
     * @param {Doctype} doctype
     * @api public
     */
    
    visitDoctype: function(doctype){
        var name = doctype.val;
        if ('5' == name) this.terse = true;
        doctype = doctypes[name || 'default'];
        if (!doctype) throw new Error('unknown doctype "' + name + '"');
        this.buffer(doctype);
    },
    
    /**
     * Visit `tag` buffering tag markup, generating
     * attributes, visiting the `tag`'s code and block.
     *
     * @param {Tag} tag
     * @api public
     */
    
    visitTag: function(tag){
        var name = tag.name;

        // Indentation
        var indents = this.pretty
            ? Array(this.indents).join(' ')
            : '';

        // Newline
        var nl = this.pretty ? '\\n' : '';

        if (~selfClosing.indexOf(name)) {
            this.buffer(nl + indents + '<' + name);
            this.visitAttributes(tag.attrs);
            this.terse
                ? this.buffer('>')
                : this.buffer('/>');
        } else {
            this.buffer(nl + indents + '<' + name);
            if (tag.attrs.length) this.visitAttributes(tag.attrs);
            this.buffer('>');
            if (tag.code) this.visitCode(tag.code);
            this.visit(tag.block);
            this.buffer('</' + name + '>');
        }
    },
    
    /**
     * Visit `filter`, throwing when the filter does not exist.
     *
     * @param {Filter} filter
     * @api public
     */
    
    visitFilter: function(filter){
        var fn = filters[filter.name];
        if (!fn) throw new Error('unknown filter ":' + filter.name + '"');
        if (filter.block instanceof nodes.Block) {
            this.buf.push(fn(filter.block, this, filter.attrs));
        } else {
            this.buffer(fn(utils.text(filter.block), filter.attrs));
        }
    },
    
    /**
     * Visit `text` node.
     *
     * @param {Text} text
     * @api public
     */
    
    visitText: function(text){
        this.buffer(utils.text(text));
    },
    
    /**
     * Visit a `comment`, only buffering when the buffer flag is set.
     *
     * @param {Comment} comment
     * @api public
     */
    
    visitComment: function(comment){
        if (!comment.buffer) return;
        this.buffer('<!--' + utils.escape(comment.val) + '-->');
    },
    
    /**
     * Visit `code`, respecting buffer / escape flags.
     * If the code is followed by a block, wrap it in
     * a self-calling function.
     *
     * @param {Code} code
     * @api public
     */
    
    visitCode: function(code){
        if (code.buffer) {
            var val = code.val.trimLeft();
            if (code.escape) val = 'escape(' + val + ')';
            this.buf.push("buf.push(" + val + ");");
        } else {
            this.buf.push(code.val);
        }
        if (code.block) {
            this.buf.push('  (function(){');
            this.visit(code.block);
            this.buf.push('  }).call(this);');
        }
    },
    
    /**
     * Visit `each` block.
     *
     * @param {Each} each
     * @api public
     */
    
    visitEach: function(each){
        this.buf.push(''
            + '// iterate ' + each.obj + '\n'
            + '(function(){\n'
            + '  for (var ' + each.key + ' in ' + each.obj + ') {\n'
            + '    var ' + each.val + ' = ' + each.obj + '[' + each.key + '];\n');
        this.visit(each.block);
        this.buf.push('  }\n}).call(this);\n');
    },
    
    /**
     * Visit `attrs`.
     *
     * @param {Array} attrs
     * @api public
     */
    
    visitAttributes: function(attrs){
        var buf = [],
            classes = [];
        if (this.terse) buf.push('terse: true');
        attrs.forEach(function(attr){
            if (attr.name == 'class') {
                classes.push('(' + attr.val + ')');
            } else {
                var pair = "'" + attr.name + "':(" + attr.val + ')';
                buf.push(pair);
            }
        });
        if (classes.length) {
            classes = classes.join(" + ' ' + ");
            buf.push("class: " + classes);
        }
        this.buf.push("buf.push(attrs({ " + buf.join(', ') + " }));");
    }
};